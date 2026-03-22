import * as ReactOverlay from "@deshlo/react/overlay";

export default function App() {
  const { OverlayGate } = ReactOverlay;
  const enabled = import.meta.env.VITE_SOURCE_INSPECTOR === "1";

  return (
    <main className="container">
      {enabled ? (
        <OverlayGate
          onSubmit={async (input, context) => ({
            ok: true,
            message: `Custom handler received ${input.tagName} at ${input.sourceLoc} on ${context.host}.`,
          })}
        />
      ) : null}

      <h1>React Sample App</h1>
      <p>
        This is a plain React app in the monorepo. Set
        <code>VITE_SOURCE_INSPECTOR=1</code> and hold <strong>Alt</strong> + click to inspect source
        locations with the plugin-driven overlay runtime.
      </p>

      <section className="grid">
        <article className="card">
          <h2>Section A</h2>
          <p>Use this element to verify metadata injection output.</p>
        </article>
        <article className="card">
          <h2>Section B</h2>
          <p>The sample app uses OverlayGate onSubmit without plugin wrappers.</p>
        </article>
      </section>
    </main>
  );
}
