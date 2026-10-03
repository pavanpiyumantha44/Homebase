// A small house with a spark inside: "home" for your local AI conversations.
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="var(--accent)" />
      <path
        d="M14 6.5 5.5 13.6a.8.8 0 0 0 .5 1.4h1.2V20a1.5 1.5 0 0 0 1.5 1.5h10.6a1.5 1.5 0 0 0 1.5-1.5v-5H22a.8.8 0 0 0 .5-1.4Z"
        fill="var(--accent-ink)"
      />
      <circle cx="14" cy="16.2" r="2" fill="var(--accent)" />
    </svg>
  )
}