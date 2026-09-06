// One rhythm: content fades gently; sheets settle with a very small spring overshoot.
export const mobileMotion = {
  page: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as [number,number,number,number] },
  sheet: { type: "spring" as const, stiffness: 440, damping: 32, mass: 0.8 },
  reduced: { duration: 0 },
};
