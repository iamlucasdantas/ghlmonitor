'use client';

import {
  Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { dayLabel } from '@/lib/format';

export function BusinessCharts({
  data,
}: { data: { date: string; msgsOut: number; msgsIn: number; contactsNew: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#232c42" vertical={false} />
          <XAxis dataKey="date" tickFormatter={dayLabel} minTickGap={24}
                 tick={{ fill: '#93a1bd', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#93a1bd', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: '#121826', border: '1px solid #232c42',
              borderRadius: 8, fontSize: 12, color: '#e6ecf8',
            }}
            labelFormatter={(d) => dayLabel(d as string)}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#93a1bd' }} />
          <Bar dataKey="msgsOut" name="Enviadas" fill="#60a5fa" radius={[2, 2, 0, 0]} />
          <Bar dataKey="msgsIn" name="Recebidas" fill="#334155" radius={[2, 2, 0, 0]} />
          <Line type="monotone" dataKey="contactsNew" name="Contatos novos"
                stroke="#34d399" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
