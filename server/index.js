import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, getConfig, setConfig, transacao } from './db.js';
import { lerBoleto, encontrarBoletosNoTexto } from './lib/boleto.js';
import { identificarCodigo, lerXmlNfe, consultarNfce, lerChave } from './lib/nfe.js';
import { provedorAtual } from './lib/whatsapp.js';
import { infoTelegram, iniciarTelegram, removerChat } from './lib/telegram.js';
import { iniciarAgendador, enviarAvisos, montarMensagem, agoraLocal } from './alertas.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SENHA = process.env.APP_PASSWORD || 'paopuro';
if (!process.env.APP_PASSWORD) console.warn('⚠️  APP_PASSWORD não definida – usando a senha padrão "paopuro". Defina uma senha em produção!');

app.use(express.json({ limit: '10mb' }));

// ---------- Autenticação simples por senha ----------
app.post('/api/login', (req, res) => {
  const a = Buffer.from(String(req.body?.senha || ''));
  const b = Buffer.from(SENHA);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ erro: 'Senha incorreta' });
  const token = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessoes (token) VALUES (?)').run(token);
  res.json({ token });
});

app.use('/api', (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token && db.prepare('SELECT 1 FROM sessoes WHERE token = ?').get(token)) return next();
  res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
});

const rota = (fn) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json(r ?? { ok: true });
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 400).json({ erro: e.message || 'Erro inesperado' });
  }
};
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- Painel ----------
app.get('/api/resumo', rota(() => {
  const hoje = agoraLocal().data;
  const em7 = new Date(hoje + 'T12:00:00Z');
  em7.setUTCDate(em7.getUTCDate() + 7);
  const soma = (sql, ...p) => db.prepare(sql).get(...p);
  return {
    hoje,
    vencemHoje: soma("SELECT COUNT(*) qtd, COALESCE(SUM(valor),0) total FROM contas WHERE status='aberta' AND vencimento = ?", hoje),
    atrasadas: soma("SELECT COUNT(*) qtd, COALESCE(SUM(valor),0) total FROM contas WHERE status='aberta' AND vencimento < ?", hoje),
    proximos7: soma("SELECT COUNT(*) qtd, COALESCE(SUM(valor),0) total FROM contas WHERE status='aberta' AND vencimento > ? AND vencimento <= ?", hoje, em7.toISOString().slice(0, 10)),
    contasHoje: db.prepare("SELECT * FROM contas WHERE status='aberta' AND vencimento <= ? ORDER BY vencimento, valor DESC LIMIT 10").all(hoje),
    estoqueBaixo: db.prepare('SELECT * FROM produtos WHERE estoque_minimo > 0 AND estoque <= estoque_minimo ORDER BY nome LIMIT 10').all(),
    ultimasNotas: db.prepare('SELECT * FROM notas ORDER BY id DESC LIMIT 5').all(),
  };
}));

// ---------- Notas fiscais ----------
function sugerirProdutos(nota) {
  const vinc = db.prepare('SELECT v.fator, p.* FROM produto_vinculos v JOIN produtos p ON p.id = v.produto_id WHERE v.cnpj_fornecedor = ? AND v.codigo_fornecedor = ?');
  const porEan = db.prepare('SELECT * FROM produtos WHERE ean = ? LIMIT 1');
  nota.itens = nota.itens.map((it) => {
    const v = it.codigo ? vinc.get(nota.emitente.cnpj, it.codigo) : null;
    if (v) return { ...it, produtoId: v.id, produtoNome: v.nome, produtoUnidade: v.unidade, fator: v.fator, sugestao: 'vinculo' };
    const p = it.ean ? porEan.get(it.ean) : null;
    if (p) return { ...it, produtoId: p.id, produtoNome: p.nome, produtoUnidade: p.unidade, fator: 1, sugestao: 'ean' };
    return { ...it, produtoId: null, fator: 1, sugestao: null };
  });
  const ja = nota.chave ? db.prepare('SELECT id, criado_em FROM notas WHERE chave = ?').get(nota.chave) : null;
  nota.jaImportada = ja || null;
  if (nota.duplicatas?.length) {
    const existe = db.prepare("SELECT 1 FROM contas WHERE nota_id IN (SELECT id FROM notas WHERE chave = ?) AND vencimento = ? AND valor = ?");
    nota.duplicatas = nota.duplicatas.map((d) => ({ ...d, jaCadastrada: !!existe.get(nota.chave, d.vencimento, d.valor) }));
  }
  return nota;
}

app.post('/api/notas/identificar', rota((req) => {
  const id = identificarCodigo(req.body.codigo);
  if (id.chave) id.jaImportada = db.prepare('SELECT id, criado_em FROM notas WHERE chave = ?').get(id.chave) || null;
  return id;
}));

app.post('/api/notas/consultar', rota(async (req) => sugerirProdutos(await consultarNfce(req.body.url))));

app.post('/api/notas/xml', rota((req) => sugerirProdutos(lerXmlNfe(String(req.body.xml || '')))));

app.post('/api/notas/manual', rota((req) => {
  const info = req.body.chave ? lerChave(req.body.chave) : null;
  return sugerirProdutos({
    chave: info?.chave || null, modelo: info?.modelo || null, numero: info?.numero || '', serie: info?.serie || '',
    dataEmissao: agoraLocal().data, emitente: { cnpj: info?.cnpjEmitente || '', nome: req.body.fornecedor || '' },
    valorTotal: 0, itens: [], duplicatas: [],
  });
}));

function entradaEstoque(produtoId, qtd, custoUnit, notaId, obs) {
  const p = db.prepare('SELECT estoque, custo_medio FROM produtos WHERE id = ?').get(produtoId);
  if (!p) throw erro(`Produto ${produtoId} não encontrado`);
  const novoEstoque = p.estoque + qtd;
  let custoMedio = p.custo_medio;
  if (custoUnit > 0) {
    custoMedio = p.estoque > 0 && p.custo_medio > 0 ? (p.estoque * p.custo_medio + qtd * custoUnit) / novoEstoque : custoUnit;
  }
  db.prepare('UPDATE produtos SET estoque = ?, custo_medio = ?, ultimo_custo = CASE WHEN ? > 0 THEN ? ELSE ultimo_custo END WHERE id = ?')
    .run(novoEstoque, custoMedio, custoUnit, custoUnit, produtoId);
  db.prepare("INSERT INTO movimentos (produto_id, tipo, quantidade, custo_unitario, nota_id, observacao) VALUES (?, 'entrada', ?, ?, ?, ?)")
    .run(produtoId, qtd, custoUnit || null, notaId, obs || null);
}

app.post('/api/notas/confirmar', rota((req) => {
  const { nota, itens = [], duplicatas = [], origem = 'manual' } = req.body;
  if (!nota) throw erro('Nota não informada');
  if (nota.chave && db.prepare('SELECT 1 FROM notas WHERE chave = ?').get(nota.chave)) throw erro('Esta nota já foi lançada no estoque.');
  const validos = itens.filter((i) => !i.ignorar);
  if (!validos.length && !duplicatas.length) throw erro('Nenhum item selecionado.');

  return transacao(() => {
    const total = Number(nota.valorTotal) || validos.reduce((s, i) => s + Number(i.valorTotal || 0), 0);
    const { lastInsertRowid: notaId } = db.prepare(`INSERT INTO notas (chave, modelo, numero, serie, data_emissao, fornecedor_cnpj, fornecedor_nome, valor_total, origem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(nota.chave || null, nota.modelo || null, nota.numero || null, nota.serie || null,
      nota.dataEmissao || null, nota.emitente?.cnpj || null, nota.emitente?.nome || null, total, origem);

    const insProd = db.prepare('INSERT INTO produtos (nome, unidade, ean) VALUES (?, ?, ?)');
    const upVinc = db.prepare(`INSERT INTO produto_vinculos (cnpj_fornecedor, codigo_fornecedor, produto_id, fator) VALUES (?, ?, ?, ?)
      ON CONFLICT(cnpj_fornecedor, codigo_fornecedor) DO UPDATE SET produto_id = excluded.produto_id, fator = excluded.fator`);

    for (const it of validos) {
      let produtoId = it.produtoId;
      if (!produtoId) {
        const nome = (it.novoNome || it.descricao || '').trim();
        if (!nome) throw erro('Item sem produto definido');
        produtoId = Number(insProd.run(nome, (it.novaUnidade || it.unidade || 'UN').toUpperCase(), it.ean || null).lastInsertRowid);
      }
      const fator = Number(it.fator) > 0 ? Number(it.fator) : 1;
      const qtd = Number(it.quantidade) * fator;
      const custo = qtd > 0 ? Number(it.valorTotal || 0) / qtd : 0;
      entradaEstoque(produtoId, qtd, custo, Number(notaId), `${it.descricao} (${it.quantidade} ${it.unidade} × ${fator})`);
      if (nota.emitente?.cnpj && it.codigo) upVinc.run(nota.emitente.cnpj, String(it.codigo), produtoId, fator);
    }

    const insConta = db.prepare(`INSERT INTO contas (descricao, fornecedor, valor, vencimento, nota_id) VALUES (?, ?, ?, ?, ?)`);
    for (const d of duplicatas) {
      insConta.run(`NF ${nota.numero || ''} – parcela ${d.numero || ''}`.trim(), nota.emitente?.nome || null, Number(d.valor), d.vencimento, Number(notaId));
    }
    return { id: Number(notaId), itens: validos.length, contas: duplicatas.length };
  });
}));

app.get('/api/notas', rota(() => db.prepare(`SELECT n.*, (SELECT COUNT(*) FROM movimentos m WHERE m.nota_id = n.id) itens
  FROM notas n ORDER BY n.id DESC LIMIT 200`).all()));

app.get('/api/notas/:id', rota((req) => {
  const nota = db.prepare('SELECT * FROM notas WHERE id = ?').get(req.params.id);
  if (!nota) throw erro('Nota não encontrada', 404);
  nota.movimentos = db.prepare('SELECT m.*, p.nome, p.unidade FROM movimentos m JOIN produtos p ON p.id = m.produto_id WHERE m.nota_id = ?').all(nota.id);
  nota.contas = db.prepare('SELECT * FROM contas WHERE nota_id = ?').all(nota.id);
  return nota;
}));

// Exclui a nota e estorna o estoque que ela lançou
app.delete('/api/notas/:id', rota((req) => transacao(() => {
  const movs = db.prepare('SELECT * FROM movimentos WHERE nota_id = ?').all(req.params.id);
  for (const m of movs) db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?').run(m.quantidade, m.produto_id);
  db.prepare('DELETE FROM movimentos WHERE nota_id = ?').run(req.params.id);
  db.prepare("DELETE FROM contas WHERE nota_id = ? AND status = 'aberta' AND codigo_barras IS NULL").run(req.params.id);
  db.prepare('DELETE FROM notas WHERE id = ?').run(req.params.id);
  return { ok: true, estornados: movs.length };
})));

// ---------- Produtos / estoque ----------
app.get('/api/produtos', rota((req) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  return db.prepare('SELECT * FROM produtos WHERE nome LIKE ? OR ean LIKE ? ORDER BY nome LIMIT 500').all(q, q);
}));

app.get('/api/produtos/:id', rota((req) => {
  const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!p) throw erro('Produto não encontrado', 404);
  p.movimentos = db.prepare(`SELECT m.*, n.fornecedor_nome, n.numero nota_numero FROM movimentos m
    LEFT JOIN notas n ON n.id = m.nota_id WHERE m.produto_id = ? ORDER BY m.id DESC LIMIT 100`).all(p.id);
  return p;
}));

app.post('/api/produtos', rota((req) => {
  const { nome, unidade = 'UN', ean = null, estoque_minimo = 0 } = req.body;
  if (!nome?.trim()) throw erro('Informe o nome do produto');
  const r = db.prepare('INSERT INTO produtos (nome, unidade, ean, estoque_minimo) VALUES (?, ?, ?, ?)')
    .run(nome.trim(), unidade.toUpperCase(), ean || null, Number(estoque_minimo) || 0);
  return { id: Number(r.lastInsertRowid) };
}));

app.put('/api/produtos/:id', rota((req) => {
  const { nome, unidade, ean, estoque_minimo } = req.body;
  db.prepare('UPDATE produtos SET nome = ?, unidade = ?, ean = ?, estoque_minimo = ? WHERE id = ?')
    .run(nome, String(unidade || 'UN').toUpperCase(), ean || null, Number(estoque_minimo) || 0, req.params.id);
}));

app.delete('/api/produtos/:id', rota((req) => { db.prepare('DELETE FROM produtos WHERE id = ?').run(req.params.id); }));

app.post('/api/produtos/:id/movimento', rota((req) => transacao(() => {
  const { tipo, quantidade, observacao } = req.body;
  const q = Number(quantidade);
  if (!['entrada', 'saida', 'ajuste'].includes(tipo) || !(q >= 0)) throw erro('Movimento inválido');
  const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!p) throw erro('Produto não encontrado', 404);
  if (tipo === 'entrada') return entradaEstoque(p.id, q, Number(req.body.custo_unitario) || 0, null, observacao);
  const delta = tipo === 'saida' ? -q : q - p.estoque; // ajuste = contagem física
  db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?').run(delta, p.id);
  db.prepare('INSERT INTO movimentos (produto_id, tipo, quantidade, observacao) VALUES (?, ?, ?, ?)').run(p.id, tipo, delta, observacao || null);
})));

// ---------- Boletos / contas a pagar ----------
const contaDuplicada = (b) => (b.codigoBarras ? db.prepare('SELECT id, descricao, status FROM contas WHERE codigo_barras = ?').get(b.codigoBarras) : null);

app.post('/api/boletos/ler', rota((req) => {
  const b = lerBoleto(req.body.codigo);
  return { ...b, jaCadastrado: contaDuplicada(b) || null };
}));

app.post('/api/boletos/pdf', express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '15mb' }), rota(async (req) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(req.body), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
  let texto = '';
  for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
    const pg = await doc.getPage(i);
    const c = await pg.getTextContent();
    texto += c.items.map((x) => x.str).join(' ') + '\n';
  }
  const boletos = encontrarBoletosNoTexto(texto).map((b) => ({ ...b, jaCadastrado: contaDuplicada(b) || null }));
  // Tenta achar o nome do beneficiário no texto
  const benef = /Benefici[áa]rio:?\s*([^\n]{3,80}?)(?:\s+(?:CNPJ|CPF|Ag[êe]ncia|Data)|\n)/i.exec(texto);
  return { boletos, beneficiario: benef ? benef[1].trim() : null };
}));

app.get('/api/contas', rota((req) => {
  const status = req.query.status === 'paga' ? 'paga' : 'aberta';
  const ordem = status === 'paga' ? 'pago_em DESC' : 'vencimento ASC';
  return db.prepare(`SELECT * FROM contas WHERE status = ? ORDER BY ${ordem} LIMIT 500`).all(status);
}));

app.post('/api/contas', rota((req) => {
  const { descricao, fornecedor, valor, vencimento, linha_digitavel, codigo_barras, observacao } = req.body;
  if (!(Number(valor) > 0)) throw erro('Informe o valor');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento || '')) throw erro('Informe o vencimento');
  if (codigo_barras && contaDuplicada({ codigoBarras: codigo_barras })) throw erro('Este boleto já está cadastrado.');
  const r = db.prepare(`INSERT INTO contas (descricao, fornecedor, valor, vencimento, linha_digitavel, codigo_barras, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(descricao || fornecedor || 'Boleto', fornecedor || null, Number(valor), vencimento,
    linha_digitavel || null, codigo_barras || null, observacao || null);
  return { id: Number(r.lastInsertRowid) };
}));

app.put('/api/contas/:id', rota((req) => {
  const { descricao, fornecedor, valor, vencimento, observacao } = req.body;
  db.prepare('UPDATE contas SET descricao = ?, fornecedor = ?, valor = ?, vencimento = ?, observacao = ? WHERE id = ?')
    .run(descricao, fornecedor || null, Number(valor), vencimento, observacao || null, req.params.id);
}));

app.post('/api/contas/:id/pagar', rota((req) => {
  db.prepare("UPDATE contas SET status = 'paga', pago_em = ? WHERE id = ?").run(req.body?.data || agoraLocal().data, req.params.id);
}));
app.post('/api/contas/:id/reabrir', rota((req) => {
  db.prepare("UPDATE contas SET status = 'aberta', pago_em = NULL WHERE id = ?").run(req.params.id);
}));
app.delete('/api/contas/:id', rota((req) => { db.prepare('DELETE FROM contas WHERE id = ?').run(req.params.id); }));

// ---------- Configuração e avisos ----------
app.get('/api/config', rota(async () => ({
  ...getConfig(),
  telegram_codigo: undefined,
  telegram: await infoTelegram(),
  provedor: provedorAtual(),
  log: db.prepare('SELECT * FROM avisos_log ORDER BY id DESC LIMIT 10').all(),
})));
app.put('/api/config', rota((req) => {
  const { whatsapp_numeros, aviso_horario, aviso_dia_anterior, aviso_atrasadas } = req.body || {};
  const dados = { whatsapp_numeros, aviso_horario, aviso_dia_anterior, aviso_atrasadas };
  setConfig(Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined)));
}));
app.delete('/api/telegram/chats/:id', rota((req) => removerChat(req.params.id)));
app.get('/api/avisos/previa', rota(() => montarMensagem() || { texto: 'Nenhuma conta para avisar hoje. ✅' }));
app.post('/api/avisos/teste', rota(() => enviarAvisos({ forcar: true })));

// ---------- App (PWA) ----------
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('Rode "npm run build" para gerar o app.'));
}

app.listen(PORT, () => {
  console.log(`Pão Puro rodando em http://localhost:${PORT}  (WhatsApp: ${provedorAtual()})`);
  iniciarAgendador();
  iniciarTelegram({ mensagemDoDia: () => montarMensagem()?.texto });
});
