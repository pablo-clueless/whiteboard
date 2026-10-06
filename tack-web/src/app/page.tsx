import { CustomShapes } from "@/components/landing/custom-shapes";
import { ToolShowcase } from "@/components/landing/tool-showcase";
import { SyncDemo } from "@/components/landing/sync-demo";
import { MotionRoot } from "@/components/landing/bits";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { Nav } from "@/components/landing/nav";

export default function Home() {
  return (
    <MotionRoot>
      <Nav />
      <main>
        <Hero />
        <ToolShowcase />
        <SyncDemo />
        <CustomShapes />
      </main>
      <Footer />
    </MotionRoot>
  );
}
