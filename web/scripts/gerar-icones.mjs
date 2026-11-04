import sharp from 'sharp';
const src = process.argv[2];
const out = new URL('../public/', import.meta.url).pathname;
const trimmed = await sharp(src).flatten({background:'#fff'}).trim({threshold: 20}).png().toBuffer();
const meta = await sharp(trimmed).metadata();
console.log('trimmed', meta.width, meta.height);
// Logo com fundo transparente ("branco vira transparência"), para ficar bonito sobre o fundo creme
{
  const { data, info } = await sharp(trimmed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const a = Math.max(255 - data[i], 255 - data[i + 1], 255 - data[i + 2]);
    for (let c = 0; c < 3; c++) rgba[j + c] = a ? Math.round(255 - ((255 - data[i + c]) * 255) / a) : 255;
    rgba[j + 3] = a;
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).resize({ width: 900 }).png().toFile(out + 'logo.png');
}
// sample colors
const { data, info } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true });
const counts = {};
for (let i = 0; i < data.length; i += info.channels) {
  const [r,g,b] = [data[i],data[i+1],data[i+2]];
  if (r>200&&g>200&&b>200) continue;
  const k = [r,g,b].map(x=>Math.round(x/8)*8).join(',');
  counts[k]=(counts[k]||0)+1;
}
console.log(Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,4));
for (const [size, pad, name] of [[512,0.12,'icon-512.png'],[192,0.12,'icon-192.png'],[512,0.22,'icon-maskable-512.png'],[180,0.1,'apple-touch-icon.png']]) {
  const inner = Math.round(size*(1-2*pad));
  const logo = await sharp(trimmed).resize({ width: inner, height: inner, fit: 'inside' }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
    .composite([{ input: logo, gravity: 'center' }]).png().toFile(out + name);
}
