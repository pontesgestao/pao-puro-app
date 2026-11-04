// Leitura de NF-e (modelo 55) e NFC-e / cupom fiscal eletrônico (modelo 65).
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { soDigitos } from './boleto.js';

const UF = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI',
  23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES',
  33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

/** Valida o dígito da chave de acesso (módulo 11, pesos 2..9). */
export function chaveValida(chave) {
  const c = soDigitos(chave);
  if (c.length !== 44) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(c[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(c[43]);
}

/** Extrai as informações embutidas na chave de acesso de 44 dígitos. */
export function lerChave(chave) {
  const c = soDigitos(chave);
  if (c.length !== 44) return null;
  const modelo = c.slice(20, 22);
  const cnpj = c.slice(6, 20);
  return {
    chave: c,
    valida: chaveValida(c),
    uf: UF[Number(c.slice(0, 2))] || c.slice(0, 2),
    anoMes: `20${c.slice(2, 4)}-${c.slice(4, 6)}`,
    cnpjEmitente: cnpj,
    modelo,
    tipo: modelo === '65' ? 'NFC-e' : modelo === '55' ? 'NF-e' : modelo === '59' ? 'CF-e SAT' : `Modelo ${modelo}`,
    serie: String(Number(c.slice(22, 25))),
    numero: String(Number(c.slice(25, 34))),
  };
}

/** Identifica o que foi lido pela câmera: URL de QR Code de NFC-e, chave de 44 dígitos ou CF-e SAT. */
export function identificarCodigo(texto) {
  const t = String(texto || '').trim();
  if (/^https?:\/\//i.test(t)) {
    let chave = null;
    try {
      const u = new URL(t);
      const p = u.searchParams.get('p') || u.searchParams.get('chNFe') || '';
      chave = soDigitos(p.split('|')[0]).slice(0, 44);
    } catch { /* ignore */ }
    if (!chave || chave.length !== 44) {
      const m = /\d{44}/.exec(soDigitos(t));
      chave = m ? m[0] : null;
    }
    return { tipo: 'qrcode-nfce', url: t, chave, info: chave ? lerChave(chave) : null };
  }
  // CF-e SAT (SP): QR "chave|data|valor|cpf|assinatura"
  if (t.includes('|')) {
    const partes = t.split('|');
    const chave = soDigitos(partes[0]);
    if (chave.length === 44) {
      return {
        tipo: 'qrcode-sat', chave, info: lerChave(chave),
        valorTotal: partes[2] ? Number(partes[2].replace(',', '.')) : null,
      };
    }
  }
  const d = soDigitos(t);
  if (d.length === 44 && chaveValida(d)) return { tipo: 'chave', chave: d, info: lerChave(d) };
  return { tipo: 'desconhecido', texto: t };
}

const num = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  return Number(String(v).replace(',', '.')) || 0;
};

const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Lê o XML de uma NF-e/NFC-e (com ou sem nfeProc) e devolve cabeçalho, itens e duplicatas. */
export function lerXmlNfe(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const doc = parser.parse(xml);
  const nfe = doc.nfeProc?.NFe || doc.NFe || doc.enviNFe?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error('Arquivo não parece ser um XML de NF-e/NFC-e.');

  const chave = soDigitos(doc.nfeProc?.protNFe?.infProt?.chNFe || inf['@Id'] || '');
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const itens = arr(inf.det).map((det, i) => {
    const p = det.prod || {};
    const ean = [p.cEAN, p.cEANTrib].find((e) => e && /^\d{8,14}$/.test(e)) || null;
    return {
      nItem: Number(det['@nItem'] || i + 1),
      codigo: String(p.cProd ?? ''),
      ean,
      descricao: String(p.xProd ?? ''),
      ncm: p.NCM || null,
      unidade: String(p.uCom ?? 'UN').toUpperCase(),
      quantidade: num(p.qCom),
      valorUnitario: num(p.vUnCom),
      valorTotal: num(p.vProd),
    };
  });

  const duplicatas = arr(inf.cobr?.dup).map((d) => ({
    numero: String(d.nDup ?? ''),
    vencimento: String(d.dVenc ?? '').slice(0, 10),
    valor: num(d.vDup),
  }));

  return {
    chave,
    modelo: String(ide.mod || chave.slice(20, 22)),
    numero: String(ide.nNF ?? ''),
    serie: String(ide.serie ?? ''),
    dataEmissao: String(ide.dhEmi || ide.dEmi || '').slice(0, 10) || null,
    emitente: {
      cnpj: soDigitos(emit.CNPJ || emit.CPF || ''),
      nome: String(emit.xFant || emit.xNome || ''),
      razaoSocial: String(emit.xNome || ''),
    },
    valorTotal: num(inf.total?.ICMSTot?.vNF),
    itens,
    duplicatas,
  };
}

const brNum = (s) => {
  const t = String(s || '').replace(/[^\d,.-]/g, '');
  if (!t) return 0;
  return Number(t.replace(/\./g, '').replace(',', '.')) || 0;
};

/** Interpreta a página de consulta pública da NFC-e (layout "portal" usado pela maioria das SEFAZ). */
export function lerPaginaNfce(html, chave) {
  const $ = cheerio.load(html);
  const itens = [];
  $('#tabResult tr').each((i, tr) => {
    const el = $(tr);
    const descricao = el.find('.txtTit').first().text().trim();
    if (!descricao) return;
    const codigo = (/C[óo]digo:\s*([^)\s]+)/i.exec(el.find('.RCod').text()) || [])[1] || '';
    const quantidade = brNum(el.find('.Rqtd').text().replace(/Qtde\.?:/i, ''));
    const unidade = el.find('.RUN').text().replace(/UN:/i, '').trim().toUpperCase() || 'UN';
    const valorUnitario = brNum(el.find('.RvlUnit').text().replace(/Vl\.?\s*Unit\.?:/i, ''));
    const valorTotal = brNum(el.find('.valor').text());
    itens.push({
      nItem: itens.length + 1, codigo, ean: /^\d{8,14}$/.test(codigo) ? codigo : null,
      descricao, unidade, quantidade, valorUnitario, valorTotal,
    });
  });

  const textoTopo = $('#conteudo .txtCenter').text() + ' ' + $('body').text();
  const cnpj = soDigitos((/CNPJ:\s*([\d./-]+)/i.exec(textoTopo) || [])[1] || '');
  const nome = $('#u20').first().text().trim() || $('.txtTopo').first().text().trim();
  const numero = (/N[úu]mero:\s*(\d+)/i.exec(textoTopo) || [])[1] || '';
  const serie = (/S[ée]rie:\s*(\d+)/i.exec(textoTopo) || [])[1] || '';
  const em = /Emiss[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(textoTopo);
  let valorTotal = 0;
  $('#totalNota .linhaShade, #totalNota #linhaTotal, #totalNota div').each((i, d) => {
    const t = $(d).text();
    if (/Valor a pagar/i.test(t)) valorTotal = brNum($(d).find('.totalNumb').text());
  });
  if (!valorTotal) valorTotal = brNum($('.totalNumb.txtMax').first().text());
  if (!valorTotal) valorTotal = itens.reduce((s, it) => s + it.valorTotal, 0);

  return {
    chave,
    modelo: '65',
    numero,
    serie,
    dataEmissao: em ? `${em[3]}-${em[2]}-${em[1]}` : null,
    emitente: { cnpj, nome, razaoSocial: nome },
    valorTotal,
    itens,
    duplicatas: [],
  };
}

/** Baixa a página do QR Code da NFC-e na SEFAZ e extrai os itens. */
export async function consultarNfce(url) {
  const id = identificarCodigo(url);
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`A SEFAZ respondeu ${resp.status}. Tente novamente ou importe o XML.`);
  const html = await resp.text();
  const nota = lerPaginaNfce(html, id.chave);
  if (!nota.itens.length) {
    throw new Error('Não foi possível ler os itens nesta página da SEFAZ (layout diferente ou consulta indisponível). Importe o XML ou digite os itens.');
  }
  if (!nota.emitente.cnpj && id.info) nota.emitente.cnpj = id.info.cnpjEmitente;
  if (!nota.numero && id.info) nota.numero = id.info.numero;
  if (!nota.serie && id.info) nota.serie = id.info.serie;
  return nota;
}
