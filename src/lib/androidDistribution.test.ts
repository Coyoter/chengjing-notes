import { expect, it } from "vitest";
import { androidUpdateDestination } from "./androidDistribution";
it("only direct distributions offer GitHub releases",()=>{
  expect(androidUpdateDestination("direct")).toContain("github.com");
  for(const channel of ["play",undefined,"unknown"])expect(androidUpdateDestination(channel)).toContain("play.google.com");
});
