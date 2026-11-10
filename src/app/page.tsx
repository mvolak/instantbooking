export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>InstantBooking</h1>
      <p>
        M1 booking engine. The API lives under <code>/api</code> — start with{" "}
        <a href="/api/health">/api/health</a> and <a href="/api/services">/api/services</a>.
      </p>
    </main>
  );
}
