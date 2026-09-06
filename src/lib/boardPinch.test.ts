import {expect,it} from "vitest";
import {pinchViewport} from "./boardPinch";
it("雙指縮放以兩指中心為錨點，不移動白板物件",()=>{
  expect(pinchViewport({x:0,y:0,zoom:1},[{x:50,y:100},{x:150,y:100}],[{x:0,y:100},{x:200,y:100}])).toEqual({x:-100,y:-100,zoom:2});
});
it("双指平移保持縮放比例，縮放遵守原本上下限",()=>{
  expect(pinchViewport({x:0,y:0,zoom:1},[{x:0,y:0},{x:100,y:0}],[{x:20,y:30},{x:120,y:30}])).toEqual({x:20,y:30,zoom:1});
  expect(pinchViewport({x:0,y:0,zoom:.2},[{x:0,y:0},{x:100,y:0}],[{x:0,y:0},{x:1,y:0}]).zoom).toBe(.18);
});
