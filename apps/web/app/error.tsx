"use client";

export default function ErrorPage(props: { error: Error; reset: () => void }) {
  return (
    <div className="panel" role="alert">
      <h2>Application error</h2>
      <p>{props.error.message}</p>
      <button type="button" onClick={props.reset}>
        Retry
      </button>
    </div>
  );
}
