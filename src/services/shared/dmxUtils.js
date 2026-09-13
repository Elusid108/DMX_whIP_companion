const normalizePayload = (data) => {
    // Ensure data is an array
    const arrayData = Array.isArray(data) ? data : Array.from(data);
    
    // Ensure all values are valid DMX values (0-255)
    const normalizedData = arrayData.map(value => 
        Math.min(Math.max(Math.round(Number(value) || 0), 0), 255)
    );
    
    // Ensure array is exactly 512 bytes
    while (normalizedData.length < 512) normalizedData.push(0);
    if (normalizedData.length > 512) normalizedData.length = 512;
    
    return Buffer.from(normalizedData);
};

const updateUniverseFPS = (universeId, protocol, tracking) => {
    const key = `${protocol}-${universeId}`;
    const now = Date.now();
    
    if (!tracking.has(key)) {
        tracking.set(key, {
            frames: [],
            fps: 0,
            lastUpdate: now,
            droppedFrames: 0,
            lastValue: 0,
            lastZeroTime: 0,
            lastFrameTime: now
        });
    }
    
    const data = tracking.get(key);
    data.frames.push(now);
    data.lastFrameTime = now;
    
    // Keep only frames from the last second
    data.frames = data.frames.filter(timestamp => timestamp > now - 1000);
    
    if (now - data.lastUpdate >= 500) { // Update every 500ms
        const frameCount = data.frames.length;
        const timeSinceLastFrame = now - data.lastFrameTime;
        
        if (frameCount === 0 || timeSinceLastFrame > 1000) {
            if (data.lastZeroTime === 0) {
                data.lastZeroTime = now;
            }
            
            if (now - data.lastZeroTime >= 3000) {
                data.fps = 0;
                data.lastValue = 0;
            }
        } else {
            data.lastZeroTime = 0;
            const newFps = Math.round(frameCount);
            data.fps = Math.round((data.lastValue + newFps) / 2);
            data.lastValue = data.fps;
        }
        
        data.lastUpdate = now;
    }
    
    return data.lastValue;
};

const checkForDroppedFrames = (tracking, universeId, protocol, currentTimestamp) => {
    const key = `${protocol}-${universeId}`;
    const data = tracking.get(key);
    
    if (!data) return 0;
    
    const expectedInterval = 1000 / data.fps;
    const actualInterval = currentTimestamp - data.frames[data.frames.length - 2];
    
    if (actualInterval > expectedInterval * 1.5) {
        data.droppedFrames++;
        return data.droppedFrames;
    }
    
    return data.droppedFrames;
};

module.exports = {
    normalizePayload,
    updateUniverseFPS,
    checkForDroppedFrames
};