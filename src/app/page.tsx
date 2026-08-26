export default function HomePage() {
  return (
    <main className="launchdiff-home">
      <div className="launchdiff-home__inner">
        <section className="launchdiff-home__panel" aria-labelledby="launchdiff-title">
          <p className="launchdiff-home__eyebrow">Phase 01 foundation</p>
          <h1 id="launchdiff-title" className="launchdiff-home__title">
            LaunchDiff
          </h1>
          <p className="launchdiff-home__lede">
            A conservative Adobe Launch / Adobe Tags deployed-library comparator. The analyzer
            contracts and project foundation are in place; parser and comparison behavior will land
            milestone by milestone.
          </p>
          <ul className="launchdiff-home__list" aria-label="Foundation guarantees">
            <li>Strict TypeScript project scaffolded on Next.js and React.</li>
            <li>Primer provider configured as the UI foundation.</li>
            <li>Analyzer contracts live outside React, Next.js, and browser APIs.</li>
            <li>Config validation is fixture-backed by the public example.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
