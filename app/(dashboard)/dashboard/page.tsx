"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Plus, PenTool, ImageIcon, User, Code } from "lucide-react"

const actionCards = [
  {
    icon: PenTool,
    label: "Start writing",
    bgColor: "bg-orange-100",
    iconColor: "text-orange-600",
  },
  {
    icon: ImageIcon,
    label: "Search literature",
    bgColor: "bg-blue-100",
    iconColor: "text-blue-600",
  },
  {
    icon: User,
    label: "Manage citations",
    bgColor: "bg-green-100",
    iconColor: "text-green-600",
  },
  {
    icon: Code,
    label: "Analyze data",
    bgColor: "bg-pink-100",
    iconColor: "text-pink-600",
  },
]

export default function Dashboard() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-4xl font-bold mb-4 text-gray-900">Welcome to GenPaper</h2>
        <p className="text-lg text-gray-600 mb-12">
          Get started with your research projects. AI can help you write, search, and analyze. Not sure where to
          start?
        </p>

        <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
          {actionCards.map((card, index) => (
            <Card key={index} className="cursor-pointer hover:shadow-md transition-shadow border border-gray-200">
              <CardContent className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.bgColor}`}>
                  <card.icon className={`w-5 h-5 ${card.iconColor}`} />
                </div>
                <span className="font-medium text-sm text-gray-900">{card.label}</span>
                <Plus className="w-4 h-4 ml-auto text-gray-400" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
} 