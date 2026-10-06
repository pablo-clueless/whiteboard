import { Logo, NewBoardButton } from "./bits";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-[#f3f3f5]/80 backdrop-blur-md">
      <nav className="container mx-auto flex h-18 items-center justify-between px-4 sm:px-8">
        <a
          href="#top"
          aria-label="Tack home"
          className="focus-visible:ring-primary/40 rounded-md outline-none focus-visible:ring-4"
        >
          <Logo />
        </a>
        <NewBoardButton className="h-10 pl-4 text-sm [&>span]:size-7" />
      </nav>
    </header>
  );
}
