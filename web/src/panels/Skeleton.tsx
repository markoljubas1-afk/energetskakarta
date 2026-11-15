import styles from "./Skeleton.module.css";

interface Props {
  /** What is loading, for assistive technology; the bars are decoration. */
  label: string;
  rows?: number;
}

/** Placeholder bars where content is about to appear, instead of a bare "loading" line. */
export function Skeleton({ label, rows = 4 }: Props) {
  return (
    <div className={styles.skeleton} role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className={styles.bar} aria-hidden="true" data-row={i % 3} />
      ))}
    </div>
  );
}
