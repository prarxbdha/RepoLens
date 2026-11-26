import React from "react";

export function Panel({ label }) {
  return <div className="panel">{label}</div>;
}

export class Note extends React.Component {
  render() {
    return <p>note</p>;
  }
}
