const view = (
    <section>
        <style>
            .card {
                color: red;
            }

            /* stays in css */
            @media (min-width: 40rem) {
                .card {
                    display: grid;
                }
            }
        </style>
        <article className="card">content</article>
    </section>
);

const standalone = <style>.inline { color: blue; }</style>;

const from_code_block = @{
    const tone = "green";
    <style>.from-code-block { color: green; }</style>
};

export { view, standalone, from_code_block };

const pseudo = (
    <style>
        .card:hover::before {
            content: 'hover';
        }

        .card > h2:first-child,
        .title {
            font-weight: 700;
        }
    </style>
);

const motion = <style>@KEYFRAMES pulse { from { opacity: 0; } to { opacity: 1; } }</style>;

export { motion, pseudo };
