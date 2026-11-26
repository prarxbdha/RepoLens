import React, { useState as useCounter } from "react";

export interface CardProps {
  title: string;
}

/** Renders a card. */
export function Card({ title }: CardProps) {
  const [count, setCount] = useCounter(0);
  return <section onClick={() => setCount(count + 1)}>{title}</section>;
}

export class Badge extends React.Component<CardProps> {
  render() {
    return <span>{this.props.title}</span>;
  }
}

export const EMPTY_CARD = <Card title="" />;
