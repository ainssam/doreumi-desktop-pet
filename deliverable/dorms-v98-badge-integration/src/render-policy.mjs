export function needsRender({paused,dirty=false,cameraChanged=false,effectsActive=false}){return !paused||dirty||cameraChanged||effectsActive;}
