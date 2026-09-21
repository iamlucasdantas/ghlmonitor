'use client';

import {
  CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { dayLabel } from '@/lib/format';

/** Tier bands are drawn behind the line so a score reads as a verdict, not a number. */
export function ScoreHistory({ data }: { data: { date: string; score: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#232c42" vertical={false} />
          <ReferenceArea y1={0} y2={40} fill="#f43f5e" fillOpacity={0.06} />
          <ReferenceArea y1={40} y2={70} fill="#f59e0b" fillOpacity={0.06} />
          <ReferenceArea y1={70} y2={100} fill="#10b981" fillOpacity={0.06} />
          <XAxis dataKey="date" tickFormatter={dayLabel} minTickGap={24}
                 tick={{ fill: '#93a1bd', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: '#93a1bd', fontSize: 11 }}
                 axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: '#121826', border: '1px solid #232c42',
              borderRadius: 8, fontSize: 12, color: '#e6ecf8',
            }}
            labelFormatter={(d) => dayLabel(d as string)}
          />
          <Line type="monotone" dataKey="score" name="Score" stroke="#60a5fa"
                strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
