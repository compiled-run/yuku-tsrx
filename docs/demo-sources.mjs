// The TSRX snippet the home page hero panel shows. It is the same file the
// README uses, so the two cannot drift apart, and it is only ever highlighted:
// nothing on this site executes it.
export const heroCode = `export function Cart({ items }): unknown @{
  const total = items.length;

  <section className="cart">
    @if (total > 0) {
      @for (const item of items; index i; key item.id) {
        <span>{i}:{item.id}</span>
      } @empty {
        <span>empty</span>
      }
    } @else {
      <span>no cart</span>
    }
    <style>.cart { display: grid; }</style>
  </section>
}`
