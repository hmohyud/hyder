import React from 'react';

export default function About() {
  return (
    <div style={{
      height: '100vh',
      padding: '0 2rem',
      boxSizing: 'border-box',
      maxWidth: '900px',
      margin: '0 auto',
      fontFamily: 'monospace',
      color: '#eaeaea',
      lineHeight: 1.6,
    }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '1.5rem', borderBottom: '1px solid #444', paddingBottom: '0.5rem' }}>
        About Me
      </h1>

      {/* Origin */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.6rem', color: '#00d1ff' }}>Early Context</h2>
        <p>
          I was born in Boston, moved to Salt Lake City as a baby, and spent my earliest years surrounded by mountains and dry air. At age six, my family relocated again—and while most of my year was spent in the U.S., I grew up spending every summer in India, visiting extended family.
        </p>
        <p>
          That rhythm—switching continents, routines, and mental frames every few months—taught me early on that there's never just one way to think or live. It gave me a taste for the unfamiliar, the layered, and the nonlinear. Those instincts show up everywhere in my work.
        </p>
      </section>

{/* Personality & Interests */}
<section style={{ marginBottom: '2rem' }}>
  <h2 style={{ fontSize: '1.6rem', color: '#00ff88' }}>Outside the Terminal</h2>
  <p>
    I played a lot of sports growing up—soccer, squash, track and field, sailing, and baseball. I wasn't a standout on most teams, but I enjoyed being active and staying in shape. Squash was the one sport I really focused on, and I was one of the stronger players on the team.
  </p>
  <p>
    I was probably more studious than anything else. I liked school, I liked learning, and I spent a lot of time reading or tinkering with things. These days, that balance has just shifted toward programming, chess puzzles, and the occasional deep dive into a video game with friends.
  </p>
</section>


      {/* Education Journey */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.6rem', color: '#ff8888' }}>Education, Interrupted</h2>
        <p>
          I studied Computer Science and Visual Arts at the University of Chicago. My academic path wasn't entirely linear—like a lot of people, I took a break during COVID. But stepping away was clarifying. It gave me time to reflect on what I actually wanted to build, and what kind of developer I wanted to become.
        </p>
        <p>
          That break turned out to be formative. I didn't stop learning—I just stopped waiting for permission to apply what I'd already learned. I built tools, experimented with AI models, helped others debug, and spent time thinking about the craft of programming beyond assignments and deadlines.
        </p>
      </section>

      {/* Teaching + Empathy */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.6rem', color: '#b48bff' }}>Teaching and Tech</h2>
        <p>
          I've taught programming to high school students, mentored veterans transitioning into tech, and tutored thousands of hours across math, science, and writing. These experiences shaped how I think about clarity, empathy, and the responsibility we carry when we build software for other people.
        </p>
        <p>
          I don't just want code to run—I want it to make sense. To feel like it belongs. That's true whether I'm designing a function, a UI, or a learning environment. Good tools invite understanding. Great tools invite play.
        </p>
      </section>

      {/* Philosophy */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.6rem', color: '#ffaa00' }}>Why I Build</h2>
        <p>
          What excites me most is software that stretches the boundaries of how we see or think. Tools that surprise you with their elegance—or their weirdness. I'm especially interested in work that blends expressive potential with technical challenge: where the medium is flexible and the results are unpredictable.
        </p>
        <p>
          I love the full arc—from backend logic and infrastructure to polished UI and interaction design. My favorite work doesn't just execute—it provokes. And if I can build something that teaches me along the way, even better.
        </p>
      </section>

      {/* Closing */}
      <section style={{ marginBottom: '4rem' }}>
        <h2 style={{ fontSize: '1.6rem', color: '#ffffff' }}>In Short</h2>
        <p>
          I'm not trying to do everything. I'm trying to do a few strange, sharp, and well-constructed things really well. I care deeply about the details, about unexpected edges, and about software that earns your attention—not just demands it.
        </p>
        <p>
          If you've made it this far, thanks for reading. I hope something here resonated.
        </p>
      </section>


            <div style={{ height: "30px" }}></div>

    </div>
  );
}
