// Generate tray icons (green/gray) using canvas
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
  // We'll draw a rounded square with a diagonal "bridge"
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
console.log('All icons generated!');
