const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const SVG_PATH = path.join(__dirname, '..', 'build', 'icon.svg');
const ICO_PATH = path.join(__dirname, '..', 'build', 'icon.ico');
const PNG_PATH = path.join(__dirname, '..', 'build', 'icon.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main(){
  const svg = fs.readFileSync(SVG_PATH);

  await sharp(svg).resize(256, 256).png().toFile(PNG_PATH);

  const pngBuffers = await Promise.all(
    SIZES.map(size => sharp(svg).resize(size, size).png().toBuffer())
  );
  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(ICO_PATH, icoBuffer);

  console.log('generated:', ICO_PATH, PNG_PATH);
}

main().catch(err => { console.error(err); process.exit(1); });
