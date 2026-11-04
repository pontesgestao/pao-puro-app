import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

/**
 * Leitor de códigos pela câmera.
 *  modo "nota":   QR Code da NFC-e / cupom e código de barras (CODE-128) do DANFE
 *  modo "boleto": código de barras ITF de 44 dígitos do boleto
 * Usa o leitor nativo do Android (BarcodeDetector) quando disponível e o ZXing como reserva.
 *
 * props: modo, titulo, validar(texto) => true | string(erro), onLido(texto), onFechar(), onDigitar()
 */
export default function Scanner({ modo, titulo, validar = () => true, onLido, onFechar, onDigitar }) {
  const video = useRef(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [lanterna, setLanterna] = useState(null); // null = não suportada
  const trilha = useRef(null);
  const finalizado = useRef(false);

  const formatosNativos = modo === 'boleto' ? ['itf'] : ['qr_code', 'code_128'];
  const formatosZxing = modo === 'boleto'
    ? [BarcodeFormat.ITF]
    : [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128];

  const tentar = (texto) => {
    if (finalizado.current || !texto) return;
    const r = validar(texto);
    if (r === true) {
      finalizado.current = true;
      if (navigator.vibrate) navigator.vibrate(80);
      onLido(texto);
    } else if (typeof r === 'string') {
      setAviso(r);
    }
  };

  useEffect(() => {
    let parar = () => {};
    let ativo = true;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErro('Este navegador não permite usar a câmera. Abra o app pelo endereço https:// ou use "Foto" / "Digitar".');
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (e) {
        setErro('Não consegui acessar a câmera. Permita o uso da câmera nas configurações do navegador.');
        return;
      }
      if (!ativo) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      trilha.current = track;
      try {
        const cap = track.getCapabilities?.() || {};
        if (cap.torch) setLanterna(false);
        if (cap.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch { /* opcional */ }

      let nativo = null;
      if ('BarcodeDetector' in window) {
        try {
          const suportados = await window.BarcodeDetector.getSupportedFormats();
          const fs = formatosNativos.filter((f) => suportados.includes(f));
          if (fs.length === formatosNativos.length) nativo = new window.BarcodeDetector({ formats: fs });
        } catch { /* usa zxing */ }
      }

      if (nativo) {
        const timer = setInterval(async () => {
          if (v.readyState < 2) return;
          try {
            const res = await nativo.detect(v);
            for (const r of res) tentar(r.rawValue);
          } catch { /* frame ruim */ }
        }, 180);
        parar = () => clearInterval(timer);
      } else {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formatosZxing);
        hints.set(DecodeHintType.TRY_HARDER, true);
        if (modo === 'boleto') hints.set(DecodeHintType.ALLOWED_LENGTHS, new Int32Array([44]));
        const leitor = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        const controles = await leitor.decodeFromVideoElement(v, (res) => { if (res) tentar(res.getText()); });
        parar = () => controles.stop();
      }
    })();

    return () => {
      ativo = false;
      parar();
      const v = video.current;
      v?.srcObject?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alternarLanterna = async () => {
    try {
      await trilha.current.applyConstraints({ advanced: [{ torch: !lanterna }] });
      setLanterna(!lanterna);
    } catch { setLanterna(null); }
  };

  const lerFoto = async (e) => {
    const arq = e.target.files?.[0];
    e.target.value = '';
    if (!arq) return;
    setAviso('Analisando a foto…');
    try {
      if ('BarcodeDetector' in window) {
        const det = new window.BarcodeDetector({ formats: formatosNativos });
        const res = await det.detect(await createImageBitmap(arq));
        if (res.length) { res.forEach((r) => tentar(r.rawValue)); if (finalizado.current) return; }
      }
      const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, formatosZxing], [DecodeHintType.TRY_HARDER, true]]);
      const url = URL.createObjectURL(arq);
      const r = await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
      URL.revokeObjectURL(url);
      tentar(r.getText());
      if (!finalizado.current) setAviso('Código lido, mas não é válido. Tente outra foto.');
    } catch {
      setAviso('Não encontrei um código na foto. Tente com mais luz e o código inteiro na imagem.');
    }
  };

  return (
    <div className="scanner">
      <div className="scanner-topo">
        <button className="btn-icone claro" onClick={onFechar} aria-label="Fechar">✕</button>
        <strong>{titulo}</strong>
        {lanterna !== null ? (
          <button className={`btn-icone claro ${lanterna ? 'ativo' : ''}`} onClick={alternarLanterna} aria-label="Lanterna">🔦</button>
        ) : <span style={{ width: 40 }} />}
      </div>
      <div className="scanner-area">
        <video ref={video} playsInline muted />
        <div className={`scanner-mira ${modo}`}><span className="scanner-linha" /></div>
      </div>
      <div className="scanner-rodape">
        {erro ? <p className="scanner-erro">{erro}</p> : (
          <p>{modo === 'boleto'
            ? 'Deite o celular e enquadre o código de barras do boleto inteiro dentro da faixa.'
            : 'Aponte para o QR Code do cupom ou para o código de barras da nota (DANFE).'}</p>
        )}
        {aviso && <p className="scanner-aviso">{aviso}</p>}
        <div className="linha-botoes">
          <label className="btn claro">
            📷 Foto
            <input type="file" accept="image/*" capture="environment" hidden onChange={lerFoto} />
          </label>
          {onDigitar && <button className="btn claro" onClick={onDigitar}>⌨️ Digitar</button>}
        </div>
      </div>
    </div>
  );
}
