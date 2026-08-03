import { useState } from "react";
import { games } from "./core/gameRegistry";
import { ListingCard } from "./components/ListingCard";
import { CompassMark } from "./components/CompassMark";
import { DarkModeToggle } from "./components/DarkModeToggle";

function App() {
  const [activeGameId, setActiveGameId] = useState<string | null>(
    games.length === 1 ? games[0]!.id : null,
  );
  const activeGame = games.find((g) => g.id === activeGameId);

  if (activeGame) {
    const GameComponent = activeGame.component;
    // A single-game shelf has nowhere to navigate "back" to — skip the
    // picker chrome entirely. Add a second game to gameRegistry.ts and this
    // (and the shelf below) comes back automatically, no further changes.
    if (games.length === 1) {
      return (
        <div className="min-h-svh bg-paper dark:bg-paper-dark">
          <GameComponent />
        </div>
      );
    }
    return (
      <div className="min-h-svh bg-paper dark:bg-paper-dark">
        <button
          onClick={() => setActiveGameId(null)}
          title="Back to the shelf"
          className="group flex cursor-pointer items-center gap-2 p-4 transition-colors"
        >
          <CompassMark className="h-5 w-5 shrink-0 text-cat-red transition-transform duration-300 group-hover:-rotate-45 dark:text-cat-red-dark" />
          <span className="font-serif text-base font-semibold text-ink group-hover:text-ink-soft dark:text-ink-dark dark:group-hover:text-ink-soft-dark">
            {activeGame.title}
          </span>
        </button>
        <GameComponent />
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-paper dark:bg-paper-dark">
      <header className="relative mx-auto max-w-2xl px-6 pt-12 pb-6 text-center">
        <DarkModeToggle className="absolute right-4 top-4 rounded-full bg-paper-card px-3 py-1.5 shadow-sm dark:bg-paper-card-dark" />
        <h1 className="font-serif text-4xl font-semibold text-ink dark:text-ink-dark">
          Games
        </h1>
        <p className="mt-2 text-ink-soft dark:text-ink-soft-dark">
          A small shelf of trivia and quiz games.
        </p>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {games.map((game, index) => (
            <ListingCard key={game.id} listing={game} index={index} onSelect={setActiveGameId} />
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
