"use client";

import { useMemo, useState } from "react";

type BoardCard = {
  id: string;
  title: string;
  body: string;
};

const BOARD_COLUMNS = [
  "Backlog",
  "In Progress",
  "QA",
  "Done",
] as const;

function makeCards(label: string): BoardCard[] {
  return Array.from({ length: 14 }, (_, index) => ({
    id: `${label.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
    title: `${label} Card ${index + 1}`,
    body: `Nested scroller item ${index + 1} in ${label}.`,
  }));
}

export function ScenariosClient() {
  const [reverseColumns, setReverseColumns] = useState(false);
  const [hidePromoBlock, setHidePromoBlock] = useState(false);
  const [compactCards, setCompactCards] = useState(false);

  const boardColumns = useMemo(() => {
    const base = BOARD_COLUMNS.map((name) => ({
      name,
      cards: makeCards(name),
    }));

    return reverseColumns ? [...base].reverse() : base;
  }, [reverseColumns]);

  return (
    <div className="scenarios-root">
      <section className="scenario-controls card">
        <h2>Dynamic Toggles</h2>
        <p>Use these toggles and verify existing bubbles stay anchored or become stale as expected.</p>
        <label>
          <input
            type="checkbox"
            checked={reverseColumns}
            onChange={(event) => setReverseColumns(event.target.checked)}
          />
          Reverse nested board columns
        </label>
        <label>
          <input
            type="checkbox"
            checked={hidePromoBlock}
            onChange={(event) => setHidePromoBlock(event.target.checked)}
          />
          Hide/show promo block
        </label>
        <label>
          <input
            type="checkbox"
            checked={compactCards}
            onChange={(event) => setCompactCards(event.target.checked)}
          />
          Compact spacing in root cards
        </label>
      </section>

      <section className="scenario card">
        <h2>1) Root Scroll Stress</h2>
        <p>Long document scroll with repeated structures and varied text lengths.</p>
        <div className="long-list">
          {Array.from({ length: 28 }, (_, index) => (
            <article className={`long-list-card ${compactCards ? "compact" : ""}`} key={index}>
              <h3>Root Card {index + 1}</h3>
              <p>
                This card exists for root scroll testing. Add comments to headings, paragraphs, and
                buttons across different heights.
              </p>
              <button type="button">Primary Action {index + 1}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="scenario card">
        <h2>2) Nested Scroll Containers</h2>
        <p>
          Horizontal scroller with vertical scrollers inside each column. This is the main nested
          scroll-chain test.
        </p>
        <div className="board-scroll-x">
          <div className="board-lane-row">
            {boardColumns.map((column) => (
              <div className="board-lane" key={column.name}>
                <header>{column.name}</header>
                <div className="board-lane-scroll-y">
                  {column.cards.map((card) => (
                    <article className="board-item" key={card.id}>
                      <strong>{card.title}</strong>
                      <p>{card.body}</p>
                      <button type="button">Review {card.id}</button>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="scenario card">
        <h2>3) Sticky + Fixed Positioning</h2>
        <p>Check anchored behavior when sticky headers and fixed elements are present.</p>
        <div className="sticky-demo">
          <div className="sticky-toolbar">
            <strong>Sticky Toolbar</strong>
            <span>Scroll the panel below and annotate sticky and non-sticky nodes.</span>
          </div>
          <div className="sticky-content">
            {Array.from({ length: 20 }, (_, index) => (
              <p key={index}>
                Sticky panel paragraph {index + 1}. This tests how annotations behave with sticky
                offsets.
              </p>
            ))}
          </div>
        </div>
        <div className="fixed-chip">Fixed Chip</div>
      </section>

      <section className="scenario card">
        <h2>4) CSS Transform + Overflow Clip</h2>
        <p>Transformed elements and clipped containers can shift perceived anchor coordinates.</p>
        <div className="transform-wrap">
          <div className="transform-box">
            <h3>Scaled/Translated Box</h3>
            <p>Add a comment here and resize the viewport.</p>
            <button type="button">Transformed CTA</button>
          </div>
        </div>
        <div className="clip-shell">
          <div className="clip-item">Absolutely positioned, partially clipped content.</div>
        </div>
      </section>

      {!hidePromoBlock ? (
        <section className="scenario card promo-block">
          <h2>5) Conditional Mount/Unmount</h2>
          <p>
            This block can be hidden by toggle. Existing comments should become stale/unanchored and
            recover when remounted.
          </p>
          <button type="button">Promo CTA</button>
        </section>
      ) : null}
    </div>
  );
}

