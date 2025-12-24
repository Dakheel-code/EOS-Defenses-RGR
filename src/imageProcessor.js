const sharp = require('sharp');

// Process image: crop to show enemy name + red army grid only, add large red number
async function processOpponentImage(imageBuffer, number) {
    try {
        // Get original image metadata
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();
        const { width, height } = metadata;
        
        // Crop settings to show ONLY:
        // - Enemy name at top (right side)
        // - Red army grid (opponent's army)
        // Remove everything else: sky, VS text, your army, bottom UI, hero
        
        // For portrait screenshots (typical phone screenshots)
        const cropTopPercent = 0.02;    // Keep enemy name (remove minimal top)
        const cropBottomPercent = 0.50; // Remove bottom 50% (your army + UI)
        const cropLeftPercent = 0.05;   // Remove left edge
        const cropRightPercent = 0.25;  // Remove right side (hero area)
        
        const cropTop = Math.round(height * cropTopPercent);
        const cropBottom = Math.round(height * cropBottomPercent);
        const cropLeft = Math.round(width * cropLeftPercent);
        const cropRight = Math.round(width * cropRightPercent);
        
        const cropWidth = width - cropLeft - cropRight;
        const cropHeight = height - cropTop - cropBottom;
        
        // Crop the image to show only enemy name + red army grid
        const croppedImage = await sharp(imageBuffer)
            .extract({
                left: cropLeft,
                top: cropTop,
                width: cropWidth,
                height: cropHeight
            })
            .toBuffer();
        
        const croppedMeta = await sharp(croppedImage).metadata();
        const newWidth = croppedMeta.width;
        const newHeight = croppedMeta.height;
        
        // Number settings - Large red number
        const fontSize = Math.min(newWidth, newHeight) * 0.15; // 15% - Very large
        const numberMargin = 20;
        
        // Create large red number overlay
        const numberText = `${number}`;
        const textWidth = Math.round(fontSize * 2.2);
        const textHeight = Math.round(fontSize * 1.4);
        
        // Place number in top-left corner (empty space, not on soldiers)
        const numberSvg = `
            <svg width="${textWidth}" height="${textHeight}">
                <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                      font-family="Arial Black, sans-serif" font-size="${fontSize}" font-weight="900" 
                      fill="#FF0000" stroke="#FFFFFF" stroke-width="3">
                    ${numberText}
                </text>
            </svg>
        `;
        
        const numberBuffer = await sharp(Buffer.from(numberSvg)).png().toBuffer();
        
        // Create the final image with number overlay (no frame, no logo)
        const result = await sharp(croppedImage)
            .composite([
                {
                    input: numberBuffer,
                    left: numberMargin,
                    top: numberMargin,
                    gravity: 'northwest'
                }
            ])
            .png()
            .toBuffer();
        
        return result;
    } catch (error) {
        console.error('Error processing image:', error);
        throw error;
    }
}

module.exports = {
    processOpponentImage
};
