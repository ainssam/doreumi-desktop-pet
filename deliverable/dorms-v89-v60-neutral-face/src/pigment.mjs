export function isolatePigment(surface){
 const {width:w,height:h,rgba,bounds}=surface,mask=new Uint8Array(w*h),visited=new Uint8Array(w*h),components=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,k=4*i,px=bounds[0]+(x+.5)/w*(bounds[2]-bounds[0]),py=bounds[3]-(y+.5)/h*(bounds[3]-bounds[1]);
  if(Math.abs(px-.02)<.27&&py>-.045&&py<.30&&rgba[k+3]>250&&(rgba[k]+rgba[k+1]+rgba[k+2])/3<120)mask[i]=1;
 }
 for(let start=0;start<mask.length;start++)if(mask[start]&&!visited[start]){
  const pixels=[start];visited[start]=1;let minX=w,minY=h,maxX=0,maxY=0;
  for(let q=0;q<pixels.length;q++){const i=pixels[q],x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,j=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&mask[j]&&!visited[j]){visited[j]=1;pixels.push(j);}}
  }components.push({pixels,bounds:[minX,minY,maxX,maxY]});
 }
 components.sort((a,b)=>b.pixels.length-a.pixels.length);const keep=components.slice(0,3);
 if(keep.length!==3||keep.some(c=>c.pixels.length<20))throw new Error('Approved thinking requires three detected eye/mouth components');
 const gate=new Uint8Array(w*h),result=rgba.slice();for(let i=3;i<result.length;i+=4)result[i]=0;
 for(const c of keep)for(const i of c.pixels){const x=i%w,y=Math.floor(i/w);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<w&&ny>=0&&ny<h)gate[ny*w+nx]=1;}}
 for(let i=0;i<gate.length;i++)if(gate[i]){const k=4*i,l=(rgba[k]+rgba[k+1]+rgba[k+2])/3,t=Math.max(0,Math.min(1,(160-l)/85));result[k+3]=255*t*t*(3-2*t);}
 return {surface:{...surface,rgba:result},components:keep.map(c=>({pixels:c.pixels.length,bounds:c.bounds})),discardedComponents:components.length-3};
}
