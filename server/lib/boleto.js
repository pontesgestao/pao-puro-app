// Leitura de boletos brasileiros: bancários (linha digitável de 47 dígitos /
// código de barras de 44) e de arrecadação/concessionárias (48 / 44 começando com 8).

const BASE_FATOR = Date.UTC(1997, 9, 7); // 07/10/1997
const DIA = 86400000;

export const soDigitos = (s = '') => String(s).replace(/\D/g, '');

function mod10(num) {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let r = Number(num[i]) * peso;
    if (r > 9) r = Math.floor(r / 10) + (r % 10);
    soma += r;
    peso = peso === 2 ? 1 : 2;
  }
  const dv = (10 - (soma % 10)) % 10;
  return dv;
}

// Módulo 11 do código de barras bancário (pesos 2..9)
function mod11Bancario(num) {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

// Módulo 11 de arrecadação (pesos 2..9; resto 0/1 => 0; 10 => 1 em alguns
// segmentos, mas a FEBRABAN define 0 para restos 0 e 1)
function mod11Arrecadacao(num) {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  if (resto === 0 || resto === 1) return 0;
  if (resto === 10) return 1;
  return 11 - resto;
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Converte o fator de vencimento em data. Em 22/02/2025 o fator chegou a 9999
 * e reiniciou em 1000, então escolhemos o ciclo cuja data fica mais perto de hoje.
 */
export function fatorParaData(fator, hoje = new Date()) {
  const f = Number(fator);
  if (!f) return null;
  const ref = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  let melhor = null;
  for (let ciclo = 0; ciclo <= 3; ciclo++) {
    const ms = BASE_FATOR + (f + ciclo * 9000) * DIA;
    if (melhor === null || Math.abs(ms - ref) < Math.abs(melhor - ref)) melhor = ms;
  }
  return isoDate(melhor);
}

function linhaBancariaParaBarras(l) {
  return l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
}

function barrasBancarioParaLinha(b) {
  const livre = b.slice(19);
  const c1 = b.slice(0, 4) + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  return c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + b[4] + b.slice(5, 19);
}

function barrasArrecadacaoParaLinha(b) {
  const usaMod10 = b[2] === '6' || b[2] === '7';
  let linha = '';
  for (let i = 0; i < 4; i++) {
    const bloco = b.slice(i * 11, i * 11 + 11);
    linha += bloco + (usaMod10 ? mod10(bloco) : mod11Arrecadacao(bloco));
  }
  return linha;
}

const BANCOS = {
  '001': 'Banco do Brasil', '033': 'Santander', '041': 'Banrisul', '070': 'BRB',
  '077': 'Inter', '104': 'Caixa', '133': 'Cresol', '136': 'Unicred', '208': 'BTG Pactual',
  '237': 'Bradesco', '260': 'Nubank', '290': 'PagSeguro', '323': 'Mercado Pago',
  '336': 'C6 Bank', '341': 'Itaú', '389': 'Mercantil', '422': 'Safra', '748': 'Sicredi',
  '756': 'Sicoob', '197': 'Stone', '380': 'PicPay', '403': 'Cora', '655': 'Votorantim',
};

const SEGMENTOS = {
  '1': 'Prefeitura', '2': 'Saneamento', '3': 'Energia/Gás', '4': 'Telecomunicações',
  '5': 'Órgão governamental', '6': 'Carnê / convênio', '7': 'Multa de trânsito', '9': 'Uso exclusivo do banco',
};

/**
 * Interpreta linha digitável ou código de barras.
 * Retorna { tipo, codigoBarras, linhaDigitavel, valor, vencimento, banco, valido, erros[] }
 */
export function lerBoleto(entrada, hoje = new Date()) {
  const d = soDigitos(entrada);
  const erros = [];

  if (d.length === 47 || (d.length === 44 && d[0] !== '8')) {
    const barras = d.length === 47 ? linhaBancariaParaBarras(d) : d;
    const linha = d.length === 47 ? d : barrasBancarioParaLinha(d);
    const dvCalc = mod11Bancario(barras.slice(0, 4) + barras.slice(5));
    if (dvCalc !== Number(barras[4])) erros.push('Dígito verificador geral não confere');
    if (d.length === 47) {
      const campos = [[0, 9], [10, 20], [21, 31]];
      campos.forEach(([ini, fim], i) => {
        if (mod10(d.slice(ini, fim)) !== Number(d[fim])) erros.push(`Dígito do campo ${i + 1} não confere`);
      });
    }
    const valor = Number(barras.slice(9, 19)) / 100;
    const codBanco = barras.slice(0, 3);
    return {
      tipo: 'bancario',
      codigoBarras: barras,
      linhaDigitavel: linha,
      valor: valor || null,
      vencimento: fatorParaData(barras.slice(5, 9), hoje),
      banco: BANCOS[codBanco] ? `${codBanco} – ${BANCOS[codBanco]}` : codBanco,
      valido: erros.length === 0,
      erros,
    };
  }

  if (d.length === 48 || (d.length === 44 && d[0] === '8')) {
    let barras;
    if (d.length === 48) {
      barras = '';
      const usaMod10 = d[2] === '6' || d[2] === '7';
      for (let i = 0; i < 4; i++) {
        const bloco = d.slice(i * 12, i * 12 + 11);
        const dv = Number(d[i * 12 + 11]);
        const calc = usaMod10 ? mod10(bloco) : mod11Arrecadacao(bloco);
        if (calc !== dv) erros.push(`Dígito do bloco ${i + 1} não confere`);
        barras += bloco;
      }
    } else {
      barras = d;
    }
    const usaMod10 = barras[2] === '6' || barras[2] === '7';
    const semDv = barras.slice(0, 3) + barras.slice(4);
    const dvGeral = usaMod10 ? mod10(semDv) : mod11Arrecadacao(semDv);
    if (dvGeral !== Number(barras[3])) erros.push('Dígito verificador geral não confere');

    // Valor só é "real" quando o identificador é 6 ou 8
    const valor = barras[2] === '6' || barras[2] === '8' ? Number(barras.slice(4, 15)) / 100 : null;

    // Vencimento não é padronizado; muitas empresas colocam AAAAMMDD no campo livre.
    let vencimento = null;
    for (const pos of [19, 20, 23, 27, 35]) {
      const s = barras.slice(pos, pos + 8);
      const m = /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.exec(s);
      if (m) {
        const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
        const diff = Math.abs(ms - hoje.getTime()) / DIA;
        if (diff < 400) { vencimento = isoDate(ms); break; }
      }
    }

    return {
      tipo: 'arrecadacao',
      codigoBarras: barras,
      linhaDigitavel: d.length === 48 ? d : barrasArrecadacaoParaLinha(barras),
      valor: valor || null,
      vencimento,
      banco: SEGMENTOS[barras[1]] || 'Arrecadação',
      valido: erros.length === 0,
      erros,
    };
  }

  return {
    tipo: null, valido: false, codigoBarras: null, linhaDigitavel: null, valor: null,
    vencimento: null, banco: null,
    erros: [`Código com ${d.length} dígitos. Esperado 44 (código de barras), 47 ou 48 (linha digitável).`],
  };
}

/** Procura linhas digitáveis num texto livre (ex.: texto extraído de PDF). */
export function encontrarBoletosNoTexto(texto) {
  const achados = new Set();
  const t = String(texto).replace(/ /g, ' ');
  // Linha bancária formatada: 00190.00009 01234.567890 12345.678901 2 12340000010000
  const reBanc = /\d{5}[.\s]?\d{5}\s*\d{5}[.\s]?\d{6}\s*\d{5}[.\s]?\d{6}\s*\d\s*\d{14}/g;
  // Arrecadação: 4 blocos de 11 + dv (com hífen opcional)
  const reArr = /8\d{10}[-\s]?\d\s*\d{11}[-\s]?\d\s*\d{11}[-\s]?\d\s*\d{11}[-\s]?\d/g;
  for (const re of [reBanc, reArr]) {
    for (const m of t.matchAll(re)) achados.add(soDigitos(m[0]));
  }
  // Sequências contínuas de dígitos (PDF sem espaçamento)
  const tudo = t.replace(/[.\-\s]/g, '');
  for (const m of tudo.matchAll(/\d{47,48}/g)) {
    for (const len of [47, 48]) {
      const s = m[0].slice(0, len);
      if (lerBoleto(s).valido) achados.add(s);
    }
  }
  return [...achados].map((s) => lerBoleto(s)).filter((b) => b.valido);
}
