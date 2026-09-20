const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
export function isolateExpression(surface,baseline){
 const {width:w,height:h,rgba,bounds}=surface;if(baseline.width!==w||baseline.height!==h)throw new Error('Baseline size mismatch');
 const seed=new Uint8Array(w*h),soft=new Uint8ClampedArray(w*h),visited=new Uint8Array(w*h),components=[];let coloredPixels=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,k=4*i,px=bounds[0]+(x+.5)/w*(bounds[2]-bounds[0]),py=bounds[3]-(y+.5)/h*(bounds[3]-bounds[1]);
  if(Math.abs(px-.02)>.32||py<-.10||py>.34||rgba[k+3]<250)continue;
  const c=[rgba[k],rgba[k+1],rgba[k+2]],l=c.reduce((a,b)=>a+b)/3,chroma=Math.max(...c)-Math.min(...c),diff=Math.max(...c.map((v,j)=>Math.abs(v-baseline.rgba[k+j])));
  const stableColor=chroma>25&&diff<7;
  const dark=stableColor?0:smooth((160-l)/85),color=smooth((diff-4)/12)*smooth((chroma-8)/16);
  soft[i]=255*Math.max(dark,color);seed[i]=((l<150&&!stableColor)||(diff>8&&chroma>16))?1:0;if(color>.5)coloredPixels++;
 }
 for(let start=0;start<seed.length;start++)if(seed[start]&&!visited[start]){
  const pixels=[start];visited[start]=1;let minX=w,minY=h,maxX=0,maxY=0;
  for(let q=0;q<pixels.length;q++){const i=pixels[q],x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,j=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&seed[j]&&!visited[j]){visited[j]=1;pixels.push(j);}}
  }components.push({pixels,bounds:[minX,minY,maxX,maxY]});
 }
 const keep=components.filter(c=>c.pixels.length>=8);if(!keep.length)throw new Error('No expression features detected');
 const retained=new Uint8Array(w*h),gate=new Uint8Array(w*h);for(const c of keep)for(const i of c.pixels){retained[i]=1;const x=i%w,y=Math.floor(i/w);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<w&&ny>=0&&ny<h)gate[ny*w+nx]=1;}}
 // Fill enclosed highlights/teeth from the approved pixels, not with new paint.
 const outside=new Uint8Array(w*h),queue=new Int32Array(w*h);let count=0;
 const push=i=>{if(!outside[i]&&!retained[i]){outside[i]=1;queue[count++]=i;}};
 for(let x=0;x<w;x++){push(x);push((h-1)*w+x);}for(let y=0;y<h;y++){push(y*w);push(y*w+w-1);}
 for(let q=0;q<count;q++){const i=queue[q],x=i%w,y=Math.floor(i/w);if(x>0)push(i-1);if(x<w-1)push(i+1);if(y>0)push(i-w);if(y<h-1)push(i+w);}
 const result=rgba.slice();let holePixels=0;
 for(let i=0;i<outside.length;i++){let a=gate[i]?soft[i]:0;if(!outside[i]&&!retained[i]){a=255;holePixels++;}result[4*i+3]=a;}
 return {surface:{...surface,rgba:result},components:keep.map(c=>({pixels:c.pixels.length,bounds:c.bounds})),discardedComponents:components.length-keep.length,coloredPixels,holePixels};
}
