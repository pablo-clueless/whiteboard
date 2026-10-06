import { NewBoardButton, Pin } from "./bits";

export function Footer() {
  return (
    <footer className="mt-8 overflow-hidden px-3 sm:px-6">
      <div className="container mx-auto">
        <div className="flex flex-col items-start justify-between gap-6 border-t pt-12 md:flex-row md:items-center">
          <div>
            <p className="text-ink text-[clamp(1.8rem,3.4vw,2.6rem)] leading-none font-black tracking-[-0.04em]">
              Your next board is one click away.
            </p>
            <p className="text-ink/60 mt-3 text-[15px]">
              No sign-up. Share the link to bring people in.
            </p>
          </div>
          <NewBoardButton />
        </div>
        <div aria-hidden className="relative mt-16 select-none">
          <p className="text-ink text-[clamp(9rem,36vw,60rem)] leading-[0.72] font-black tracking-[-0.075em]">
            tack
          </p>
          <Pin className="absolute top-1/2 left-[85%] size-[clamp(3rem,11vw,20rem)] -translate-y-1/2" />
        </div>
      </div>
    </footer>
  );
}
