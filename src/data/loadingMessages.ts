const LOADING_MESSAGES = [
  "Asking a cartographer nicely…",
  "Unfolding a giant paper map…",
  "Bribing a border guard…",
  "Consulting a globe…",
  "Recalibrating the compass…",
  "Waiting for customs…",
  "Ironing out the wrinkles in Australia…",
  "Convincing Russia to hold still…",
  "Counting Indonesia's islands (all 17,000)…",
  "Reattaching Alaska to the right corner…",
];

export function randomLoadingMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]!;
}
