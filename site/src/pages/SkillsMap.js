// src/components/SkillsMap.js
import React, { useState } from 'react';
import './SkillsMap.css';

const skillsData = [
  {
    name: 'PyTorch',
    acquiredFrom: 'University coursework & Stable Diffusion project',
    example: 'Runtime tensor-layer modification with random formula injection and logging.'
  },
  {
    name: 'React',
    acquiredFrom: 'SPIM interface for Salavon’s website',
    example: 'Built dynamic UI controls for modifying AI render parameters.'
  },
  {
    name: 'Fusion 360',
    acquiredFrom: 'Hardware prototyping & Arduino integration',
    example: 'Modeled 3D-printed enclosures for gesture-controlled devices.'
  },
  {
    name: 'WebSockets',
    acquiredFrom: 'Real-time Web UI for batch experiment tracker',
    example: 'Live update pipeline connected to model inference backend.'
  }
];

export default function SkillsMap() {
  const [selectedSkill, setSelectedSkill] = useState(null);

  return (
    <div className="skills-map">
      <h2>Skills</h2>
      <div className="nodes">
        {skillsData.map((skill, index) => (
          <div key={index} className="node" onClick={() => setSelectedSkill(skill)}>
            {skill.name}
          </div>
        ))}
      </div>

      {selectedSkill && (
        <div className="skill-detail">
          <h3>{selectedSkill.name}</h3>
          <p><strong>Acquired From:</strong> {selectedSkill.acquiredFrom}</p>
          <p><strong>Example:</strong> {selectedSkill.example}</p>
          <button onClick={() => setSelectedSkill(null)}>Close</button>
        </div>
      )}
    </div>
  );
}