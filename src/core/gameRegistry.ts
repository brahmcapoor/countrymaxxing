import type { Game } from "./types";
import { CountryMaxxing } from "../games/country-maxxing/CountryMaxxing";

export const games: Game[] = [
  {
    id: "country-maxxing",
    title: "CountryMaxxing",
    tagline: "197 countries. Zero frequent flyer miles.",
    component: CountryMaxxing,
  },
];
