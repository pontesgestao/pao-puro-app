import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerBoleto, fatorParaData, encontrarBoletosNoTexto } from '../lib/boleto.js';
import { lerXmlNfe, identificarCodigo, chaveValida, lerPaginaNfce } from '../lib/nfe.js';

// Monta um código de barras bancário válido para testes
function montarBarras(banco, fator, valorCentavos, livre) {
  const semDv = banco + '9' + String(fator).padStart(4, '0') + String(valorCentavos).padStart(10, '0') + livre;
  let soma = 0, peso = 2;
  for (let i = semDv.length - 1; i >= 0; i--) { soma += +semDv[i] * peso; peso = peso === 9 ? 2 : peso + 1; }
  let dv = 11 - (soma % 11); if ([0, 10, 11].includes(dv)) dv = 1;
  return semDv.slice(0, 4) + dv + semDv.slice(4);
}

test('fator de vencimento no ciclo novo (após 22/02/2025)', () => {
  const hoje = new Date('2026-11-04T12:00:00Z');
  assert.equal(fatorParaData(1000, hoje), '2025-02-22');
  assert.equal(fatorParaData(9999, new Date('2025-02-01')), '2025-02-21');
  assert.equal(fatorParaData(1000 + 620, hoje), '2026-11-04');
});

test('boleto bancário: barras <-> linha digitável', () => {
  const hoje = new Date('2026-11-04T12:00:00Z');
  const barras = montarBarras('341', 1620, 123456, '1234567890123456789012345');
  const b1 = lerBoleto(barras, hoje);
  assert.equal(b1.valido, true, b1.erros.join());
  assert.equal(b1.valor, 1234.56);
  assert.equal(b1.vencimento, '2026-11-04');
  assert.match(b1.banco, /Itaú/);
  const b2 = lerBoleto(b1.linhaDigitavel, hoje);
  assert.equal(b2.valido, true, b2.erros.join());
  assert.equal(b2.codigoBarras, barras);
  // Erro de digitação é detectado
  const errado = b1.linhaDigitavel.slice(0, 5) + ((+b1.linhaDigitavel[5] + 1) % 10) + b1.linhaDigitavel.slice(6);
  assert.equal(lerBoleto(errado, hoje).valido, false);
  // Encontra no texto de um PDF
  const fmt = b1.linhaDigitavel.replace(/^(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d)(\d{14})$/, '$1.$2 $3.$4 $5.$6 $7 $8');
  assert.equal(encontrarBoletosNoTexto(`Pagador XYZ\nLinha: ${fmt}\n`)[0].codigoBarras, barras);
});

test('boleto de concessionária (48 dígitos)', () => {
  // monta barras de arrecadação: 8 3 6 DV valor(11) empresa+livre(29) com data 20261110
  const semDv = '836' + '00000015990' + '0123' + '20261110' + '12345678901234567';
  const mod10 = (n) => { let s = 0, p = 2; for (let i = n.length - 1; i >= 0; i--) { let r = +n[i] * p; if (r > 9) r = Math.floor(r / 10) + r % 10; s += r; p = p === 2 ? 1 : 2; } return (10 - s % 10) % 10; };
  const barras = semDv.slice(0, 3) + mod10(semDv) + semDv.slice(3);
  assert.equal(barras.length, 44);
  const b = lerBoleto(barras, new Date('2026-11-04'));
  assert.equal(b.valido, true, b.erros.join());
  assert.equal(b.valor, 159.9);
  assert.equal(b.linhaDigitavel.length, 48);
  assert.equal(lerBoleto(b.linhaDigitavel).codigoBarras, barras);
  assert.equal(b.vencimento, '2026-11-10');
});

const CHAVE = '35261112345678000199550010000012341000012345';
function chaveComDv(c43) {
  let s = 0, p = 2; for (let i = 42; i >= 0; i--) { s += +c43[i] * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11; return c43 + (r < 2 ? 0 : 11 - r);
}

test('chave de acesso e QR Code', () => {
  const ch = chaveComDv(CHAVE.slice(0, 43).replace(/^(.{20})55/, '$165'));
  assert.ok(chaveValida(ch));
  const id = identificarCodigo(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${ch}|2|1|1|ABCDEF`);
  assert.equal(id.tipo, 'qrcode-nfce');
  assert.equal(id.info.tipo, 'NFC-e');
  assert.equal(id.info.uf, 'SP');
});

test('XML de NF-e com itens e duplicatas', () => {
  const ch = chaveComDv(CHAVE.slice(0, 43));
  const xml = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${ch}">
  <ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-11-01T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>12345678000199</CNPJ><xNome>MOINHO TESTE LTDA</xNome><xFant>Moinho Teste</xFant></emit>
  <det nItem="1"><prod><cProd>FAR25</cProd><cEAN>SEM GTIN</cEAN><xProd>FARINHA TRIGO 25KG</xProd><uCom>SC</uCom><qCom>10.0000</qCom><vUnCom>95.50</vUnCom><vProd>955.00</vProd></prod></det>
  <det nItem="2"><prod><cProd>003</cProd><cEAN>7891234567895</cEAN><xProd>FERMENTO 500G</xProd><uCom>UN</uCom><qCom>12</qCom><vUnCom>8.00</vUnCom><vProd>96.00</vProd></prod></det>
  <total><ICMSTot><vNF>1051.00</vNF></ICMSTot></total>
  <cobr><dup><nDup>001</nDup><dVenc>2026-12-01</dVenc><vDup>525.50</vDup></dup><dup><nDup>002</nDup><dVenc>2026-12-31</dVenc><vDup>525.50</vDup></dup></cobr>
  </infNFe></NFe></nfeProc>`;
  const n = lerXmlNfe(xml);
  assert.equal(n.chave, ch);
  assert.equal(n.itens.length, 2);
  assert.equal(n.itens[0].ean, null);
  assert.equal(n.itens[1].ean, '7891234567895');
  assert.equal(n.itens[0].quantidade, 10);
  assert.equal(n.duplicatas.length, 2);
  assert.equal(n.valorTotal, 1051);
  assert.equal(n.emitente.nome, 'Moinho Teste');
});

test('página de consulta NFC-e (layout portal)', () => {
  const html = `<div id="conteudo"><div class="txtCenter"><div id="u20" class="txtTopo">ATACADÃO SA</div>
  <div class="text">CNPJ: 75.315.333/0001-09</div></div>
  <table id="tabResult"><tr id="Item + 1"><td><span class="txtTit">LEITE INTEGRAL 1L</span><span class="RCod">(Código: 7891000100103 )</span><br>
  <span class="Rqtd"><strong>Qtde.:</strong>12</span><span class="RUN"><strong>UN: </strong>UN</span><span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;4,59</span></td>
  <td class="txtTit noWrap">Vl. Total<br><span class="valor">55,08</span></td></tr></table>
  <div id="totalNota"><div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">55,08</span></div></div>
  <ul><li>Número: 4321 Série: 2 Emissão: 03/11/2026 09:12:00</li></ul></div>`;
  const n = lerPaginaNfce(html, null);
  assert.equal(n.itens.length, 1);
  assert.equal(n.itens[0].quantidade, 12);
  assert.equal(n.itens[0].valorUnitario, 4.59);
  assert.equal(n.itens[0].ean, '7891000100103');
  assert.equal(n.valorTotal, 55.08);
  assert.equal(n.emitente.cnpj, '75315333000109');
  assert.equal(n.numero, '4321');
  assert.equal(n.dataEmissao, '2026-11-03');
});
