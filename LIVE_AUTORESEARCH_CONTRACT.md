# Live AutoResearch Contract

Website Storage must not generate mirrored websites from mock data.

## Required Runtime

The dashboard expects a host-provided browser adapter at:

```js
window.codexLiveAutoResearch.run(job)
```

The adapter must:

1. Browse the live web for the selected niche.
2. Select high-performing reference websites.
3. Open and inspect each selected website.
4. Run site teardown on the actual source page.
5. Extract layout structure, section rhythm, CTA placement, visual hierarchy, styling direction, interactions, and mobile behavior.
6. Create an original working website page that mirrors strategy only.
7. Save the generated page as a real local file or resolvable preview URL.
8. Return Website Storage card records.

## Adapter Input

```ts
{
  id: string;
  niche: string;
  count: number;
  type: string;
  style: string;
  goal: string;
  requiredSkillOrder: string[];
  mirroringRules: {
    mirror: string[];
    neverCopy: string[];
  };
  framework: string[];
  status: "PENDING_CODEX_LIVE_BROWSE";
  createdAt: string;
}
```

## Adapter Output

Return an array of generated website records:

```ts
{
  id: string;
  name: string;
  niche: string;
  type: "SITE" | "FUNNEL" | "LANDING PAGE" | "BOOKING PAGE" | "OPT-IN PAGE";
  url: string;
  localPath: string;
  screenshot: string;
  sourceInspiration: string;
  sourceUrl: string;
  positioningAngle: string;
  headline: string;
  primaryCTA: string;
  sectionBreakdown: string[];
  designNotes: string[];
  conversionNotes: string[];
  frameworkMapping: string[];
  tags: string[];
  isFavorite: boolean;
  isArchived: boolean;
  createdAt: string;
}
```

## Non-Negotiable Rule

If live browsing, inspection, and teardown do not happen, the adapter must return an error and Website Storage must not create a generated website card.
