const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');

const convertToStudioWav = (srcPath, destPath) => new Promise((resolve, reject) => {
    if (!ffmpegPath) {
        reject(new Error('ffmpeg-static is not available'));
        return;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const args = [
        '-y',
        '-i', srcPath,
        '-ac', '2',
        '-ar', '44100',
        '-sample_fmt', 's16',
        '-c:a', 'pcm_s16le',
        destPath
    ];
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
        if (code === 0 && fs.existsSync(destPath)) {
            resolve(destPath);
            return;
        }
        reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `ffmpeg exited ${code}`));
    });
});

const tempWavPath = (id) => path.join(os.tmpdir(), 'dmx-whip-audio', `${id}.wav`);

module.exports = {
    convertToStudioWav,
    tempWavPath
};
