import { useEffect, useState, useCallback } from 'react';

export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const num = (v, casas = 3) =>
  Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });

export const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

export const hojeIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function diasAte(iso) {
  const a = new Date(hojeIso() + 'T12:00:00Z');
  const b = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

export function rotuloVencimento(iso) {
  const d = diasAte(iso);
  if (d < 0) return { texto: d === -1 ? 'Venceu ontem' : `Atrasada ${-d} dias`, cls: 'atrasada' };
  if (d === 0) return { texto: 'Vence hoje', cls: 'hoje' };
  if (d === 1) return { texto: 'Vence amanhã', cls: 'breve' };
  if (d <= 7) return { texto: `Em ${d} dias`, cls: 'breve' };
  return { texto: dataBr(iso), cls: '' };
}

export const formatarLinha = (l) => {
  const d = String(l || '').replace(/\D/g, '');
  if (d.length === 47) return d.replace(/^(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d)(\d{14})$/, '$1.$2 $3.$4 $5.$6 $7 $8');
  if (d.length === 48) return d.replace(/^(\d{11})(\d)(\d{11})(\d)(\d{11})(\d)(\d{11})(\d)$/, '$1-$2 $3-$4 $5-$6 $7-$8');
  return d;
};

export const cnpjFmt = (c) => {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d;
};

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = texto;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

/** Carrega dados de uma função assíncrona e permite recarregar. */
export function useCarregar(fn, deps = []) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const carregar = useCallback(() => {
    setEstado((e) => ({ ...e, carregando: true }));
    return fn()
      .then((dados) => setEstado({ dados, erro: null, carregando: false }))
      .catch((erro) => setEstado({ dados: null, erro: erro.message, carregando: false }));
  }, deps);
  useEffect(() => { carregar(); }, [carregar]);
  return { ...estado, recarregar: carregar };
}

/** Lê um arquivo selecionado como texto ou ArrayBuffer. */
export const lerArquivo = (arquivo, comoTexto) =>
  new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => falha(new Error('Não foi possível ler o arquivo'));
    comoTexto ? r.readAsText(arquivo, 'utf-8') : r.readAsArrayBuffer(arquivo);
  });
