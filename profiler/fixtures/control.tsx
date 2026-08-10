type CardProps = { title: string; count: number };

export const Card = ({ title, count }: CardProps) => (
  <article>
    <h1>{title}</h1>
    <output>{count}</output>
  </article>
);
