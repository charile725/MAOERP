const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const inputFile = path.join(__dirname, '../public/毛先生logo.jpg')
const outputDir = path.join(__dirname, '../public')

async function generateIcons() {
  console.log('開始生成 PWA 圖標...\n')

  const sizes = [
    { size: 180, name: 'maosir-apple-touch-icon.png', padding: 10, bgColor: '#000000' },
    { size: 192, name: 'maosir-icon-192.png', padding: 10, bgColor: '#000000' },
    { size: 512, name: 'maosir-icon-512.png', padding: 20, bgColor: '#000000' },
    { size: 192, name: 'maosir-icon-192-maskable.png', padding: 20, bgColor: '#000000' },
    { size: 512, name: 'maosir-icon-512-maskable.png', padding: 50, bgColor: '#000000' },
  ]

  for (const { size, name, padding, bgColor } of sizes) {
    const outputPath = path.join(outputDir, name)
    const contentSize = size - padding * 2

    // 將 hex 顏色轉換為 RGB
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
        alpha: 1
      } : { r: 37, g: 99, b: 235, alpha: 1 } // 預設藍色
    }

    const bgRgb = hexToRgb(bgColor)

    try {
      // 統一使用有色背景 + padding
      await sharp(inputFile)
        .resize(contentSize, contentSize, {
          fit: 'cover',
          position: 'center'
        })
        .extend({
          top: padding,
          bottom: padding,
          left: padding,
          right: padding,
          background: bgRgb
        })
        .png()
        .toFile(outputPath)

      console.log(`✓ 生成 ${name} (${size}x${size}) - ${bgColor}`)
    } catch (error) {
      console.error(`✗ 生成 ${name} 失敗:`, error.message)
    }
  }

  console.log('\n所有圖標生成完成！')
}

generateIcons().catch(console.error)
