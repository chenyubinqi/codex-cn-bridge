// Generate tray icons (green/gray) using canvas
// Also generate app icon for packaging
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// Icon size for macOS tray
const size = 32;

function generateIcon(color, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Clear background
  ctx.clearRect(0, 0, size, size);

  // Draw a simple bridge/icon shape
  const padding = 4;
  const radius = 4;

  // Background circle
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 - padding, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Draw a simple "C" for Codex in white
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(size/2 + 2, size/2, 8, 0.3 * Math.PI, 1.7 * Math.PI);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'white';
  ctx.stroke();

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'assets', filename), buffer);
  console.log(`Generated ${filename}`);
}

// Generate both icons
generateIcon('#4CAF50', 'icon-green.png');
generateIcon('#9E9E9E', 'icon-gray.png');
console.log('All tray icons generated!');

// Generate app icon in proper macOS iconset format
function generateAppIcon() {
  const outputDir = path.join(__dirname, 'assets', 'iconset.iconset');
  
  // Clean and recreate directory
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // Standard macOS iconset sizes
  const sizes = [
    { size: 16, suffix: 'icon_16x16.png' },
    { size: 32, suffix: 'icon_16x16@2x.png' },
    { size: 32, suffix: 'icon_32x32.png' },
    { size: 64, suffix: 'icon_32x32@2x.png' },
    { size: 128, suffix: 'icon_128x128.png' },
    { size: 256, suffix: 'icon_128x128@2x.png' },
    { size: 256, suffix: 'icon_256x256.png' },
    { size: 512, suffix: 'icon_256x256@2x.png' },
    { size: 512, suffix: 'icon_512x512.png' },
    { size: 1024, suffix: 'icon_512x512@2x.png' }
  ];

  sizes.forEach(({ size, suffix }) => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Clear background
    ctx.clearRect(0, 0, size, size);

    // Draw circular background
    const padding = size * 0.1;
    const radius = (size / 2) - padding;
    ctx.beginPath();
    ctx.arc(size/2, size/2, radius, 0, Math.PI * 2);
    // Gradient background from blue to purple
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, radius);
    gradient.addColorStop(0, '#4a90e2');
    gradient.addColorStop(1, '#3a2e8f');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw a simple "C" for Codex
    ctx.beginPath();
    ctx.arc(size/2 + size*0.05, size/2, size*0.25, 0.25 * Math.PI, 1.75 * Math.PI);
    ctx.lineWidth = size * 0.1;
    ctx.strokeStyle = 'white';
    ctx.stroke();

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(outputDir, suffix), buffer);
    console.log(`Generated ${suffix}`);
  });

  console.log('App iconset generated in iconset.iconset/');
}

generateAppIcon();
