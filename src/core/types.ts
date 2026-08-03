import type { ComponentType } from "react";

// Shared shape for anything selectable from a grid of cards — top-level games
// on the home screen, and quiz modes within a game.
export interface Listing {
  id: string;
  title: string;
  tagline: string;
  component: ComponentType;
}

export type Game = Listing;
