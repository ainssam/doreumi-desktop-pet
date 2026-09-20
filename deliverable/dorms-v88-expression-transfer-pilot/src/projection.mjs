// Read-only orthographic sampling in rest coordinates. No renderable geometry is created.
export function projectSurface(primitives,{bounds,width=768,height=768,minDepth=-Infinity}) {
  const [x0,y0,x1,y1]=bounds;
  if(!(x1>x0&&y1>y0&&width>0&&height>0))throw new Error('Invalid projection bounds');
  const rgba=new Uint8ClampedArray(width*height*4),depth=new Float32Array(width*height).fill(-Infinity);
  const dx=(x1-x0)/width,dy=(y1-y0)/height;
  for(const {positions:p,uvs:u,indices:idx,sample} of primitives){
    for(let k=0;k<idx.length;k+=3){
      const a=idx[k],b=idx[k+1],c=idx[k+2];
      const ax=p[3*a],ay=p[3*a+1],az=p[3*a+2],bx=p[3*b],by=p[3*b+1],bz=p[3*b+2],cx=p[3*c],cy=p[3*c+1],cz=p[3*c+2];
      if(Math.max(az,bz,cz)<minDepth)continue;
      const denominator=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
      if(Math.abs(denominator)<1e-12)continue;
      const left=Math.max(0,Math.floor((Math.min(ax,bx,cx)-x0)/dx));
      const right=Math.min(width-1,Math.floor((Math.max(ax,bx,cx)-x0)/dx));
      const top=Math.max(0,Math.floor((y1-Math.max(ay,by,cy))/dy));
      const bottom=Math.min(height-1,Math.floor((y1-Math.min(ay,by,cy))/dy));
      for(let row=top;row<=bottom;row++)for(let col=left;col<=right;col++){
        const x=x0+(col+.5)*dx,y=y1-(row+.5)*dy;
        const wa=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/denominator;
        const wb=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/denominator;
        const wc=1-wa-wb;
        if(wa<-.00001||wb<-.00001||wc<-.00001)continue;
        const z=wa*az+wb*bz+wc*cz,offset=row*width+col;
        if(z<minDepth||z<=depth[offset])continue;
        const tu=wa*u[2*a]+wb*u[2*b]+wc*u[2*c],tv=wa*u[2*a+1]+wb*u[2*b+1]+wc*u[2*c+1];
        rgba.set(sample(tu,tv),4*offset);depth[offset]=z;
      }
    }
  }
  return {rgba,depth,width,height,bounds};
}

export function fitCheekAlignment(source,target){
  const sx=source.right[0]-source.left[0],sy=source.right[1]-source.left[1];
  const tx=target.right[0]-target.left[0],ty=target.right[1]-target.left[1];
  const sd=sx*sx+sy*sy,td=tx*tx+ty*ty;
  if(!Number.isFinite(sd+td)||sd<1e-8||td<1e-8)throw new Error('Invalid landmark distance');
  // source = [a -b; b a] * target + translation; no manual eye placement.
  const a=(sx*tx+sy*ty)/td,b=(sy*tx-sx*ty)/td;
  return {a,b,tx:source.left[0]-a*target.left[0]+b*target.left[1],ty:source.left[1]-b*target.left[0]-a*target.left[1],scale:Math.sqrt(sd/td),rotation:Math.atan2(b,a)};
}

export function targetToSource(x,y,f){return [f.a*x-f.b*y+f.tx,f.b*x+f.a*y+f.ty];}

export function detectCheeks(surface,{minSamples=12}={}){
  const {rgba,width,height,bounds:[x0,y0,x1,y1]}=surface;
  const groups=[[],[]],margin=(x1-x0)*.16,center=(x0+x1)/2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=4*(y*width+x),r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    const px=x0+(x+.5)*(x1-x0)/width,py=y1-(y+.5)*(y1-y0)/height;
    if(rgba[i+3]===0||r<70||r-g<16||r-b<10||g<r*.42||Math.abs(g-b)>38||Math.abs(px-center)<margin)continue;
    groups[px<center?0:1].push([px,py]);
  }
  if(groups.some(g=>g.length<minSamples))throw new Error(`Missing cheek evidence (${groups.map(g=>g.length).join('/')})`);
  const mean=g=>[g.reduce((s,p)=>s+p[0],0)/g.length,g.reduce((s,p)=>s+p[1],0)/g.length];
  return {left:mean(groups[0]),right:mean(groups[1]),samples:groups.map(g=>g.length)};
}
