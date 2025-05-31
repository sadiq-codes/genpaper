import type React from "react"
import Link from "next/link"
import {
  ArrowRight,
  BookOpen,
  Search,
  FileText,
  Users,
  Lightbulb,
  BarChart3,
  CheckCircle,
  Star,
  Play,
  Sparkles,
  Target,
  Zap,
  Quote,
  TrendingUp,
  Award,
  Shield,
  Clock,
} from "lucide-react"

const FeatureCard = ({
  icon,
  title,
  description,
  colorClass,
  benefits,
}: {
  icon: React.ReactNode
  title: string
  description: string
  colorClass: string
  benefits?: string[]
}) => (
  <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-blue-200 transition-all duration-300 group">
    <div
      className={`w-14 h-14 rounded-xl flex items-center justify-center mb-6 ${colorClass} group-hover:scale-110 transition-transform duration-300`}
    >
      {icon}
    </div>
    <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
    <p className="text-gray-600 leading-relaxed mb-4">{description}</p>
    {benefits && (
      <ul className="space-y-2">
        {benefits.map((benefit, index) => (
          <li key={index} className="flex items-center text-sm text-gray-600">
            <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
            {benefit}
          </li>
        ))}
      </ul>
    )}
  </div>
)

const StatCard = ({ number, label, description }: { number: string; label: string; description: string }) => (
  <div className="text-center">
    <div className="text-4xl font-bold text-blue-600 mb-2">{number}</div>
    <div className="text-lg font-semibold text-gray-900 mb-1">{label}</div>
    <div className="text-sm text-gray-600">{description}</div>
  </div>
)

export default function ImprovedHomePage() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <div className="grid grid-cols-2 gap-0.5">
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                </div>
              </div>
              <span className="text-xl font-bold text-gray-900">Genpaper</span>
            </Link>

            <nav className="hidden md:flex items-center space-x-8">
              <Link
                href="#features"
                className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium"
              >
                Features
              </Link>
              <Link
                href="#how-it-works"
                className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium"
              >
                How it Works
              </Link>
              <Link
                href="#testimonials"
                className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium"
              >
                Testimonials
              </Link>
              <Link href="#pricing" className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium">
                Pricing
              </Link>
            </nav>

            <div className="flex items-center space-x-4">
              <Link href="/login" className="text-sm text-gray-600 hover:text-blue-600 transition-colors font-medium">
                Sign In
              </Link>
              <Link
                href="/signup"
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-all hover:scale-105 flex items-center space-x-2 shadow-md"
              >
                <span>Get Started Free</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-20 pb-32 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-purple-50"></div>
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-4000"></div>

        <div className="max-w-7xl mx-auto relative">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="text-left">
              <div className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4 mr-2" />
                AI-Powered Research Assistant
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-gray-900 mb-8 leading-tight">
                Write Better
                <span className="block bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 bg-clip-text text-transparent">
                  Research Papers
                </span>
                <span className="block text-4xl sm:text-5xl lg:text-6xl">with AI</span>
              </h1>

              <p className="text-xl text-gray-600 mb-10 max-w-2xl leading-relaxed">
                From literature review to final draft, Genpaper's AI helps researchers write faster, cite accurately,
                and discover insights that matter. Join 50,000+ researchers already using AI to accelerate their work.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 items-start mb-12">
                <Link
                  href="/signup"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-105 flex items-center space-x-3 shadow-lg"
                >
                  <span>Start Writing for Free</span>
                  <ArrowRight className="w-5 h-5" />
                </Link>
                <button className="flex items-center space-x-3 text-gray-600 hover:text-gray-900 transition-colors group">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
                    <Play className="w-5 h-5 text-blue-600 ml-0.5" />
                  </div>
                  <span className="font-medium">Watch Demo (2 min)</span>
                </button>
              </div>

              <div className="flex items-center space-x-8 text-sm text-gray-500">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>Free 14-day trial</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>Cancel anytime</span>
                </div>
              </div>
            </div>

            {/* Hero Visual - Enhanced */}
            <div className="relative">
              <div className="relative bg-white p-8 rounded-3xl shadow-2xl border border-gray-200">
                {/* Mock Interface */}
                <div className="space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                    </div>
                    <div className="text-sm text-gray-500">Machine Learning in Healthcare.docx</div>
                  </div>

                  {/* Content */}
                  <div className="space-y-4">
                    <div className="h-4 bg-gray-900 rounded w-3/4"></div>
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded w-full"></div>
                      <div className="h-3 bg-gray-200 rounded w-5/6"></div>
                      <div className="h-3 bg-gray-200 rounded w-4/5"></div>
                    </div>

                    {/* AI Suggestion */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 relative">
                      <div className="flex items-start space-x-3">
                        <Sparkles className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-blue-900 mb-1">AI Suggestion</div>
                          <div className="text-sm text-blue-800">
                            Consider adding recent 2024 studies on transformer models in medical diagnosis...
                          </div>
                          <div className="flex space-x-2 mt-3">
                            <button className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Accept</button>
                            <button className="border border-blue-600 text-blue-600 px-3 py-1 rounded text-xs">
                              Edit
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded w-full"></div>
                      <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                    </div>
                  </div>
                </div>

                {/* Floating Elements */}
                <div className="absolute -top-4 -right-4 bg-green-500 text-white p-3 rounded-xl shadow-lg">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <div className="absolute -bottom-4 -left-4 bg-purple-500 text-white p-3 rounded-xl shadow-lg">
                  <Target className="w-6 h-6" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <StatCard number="50,000+" label="Active Researchers" description="Trust Genpaper for their research" />
            <StatCard number="2M+" label="Papers Written" description="Using our AI assistance" />
            <StatCard number="85%" label="Time Saved" description="On average per research project" />
            <StatCard number="4.9/5" label="User Rating" description="From 10,000+ reviews" />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium mb-6">
              <Zap className="w-4 h-4 mr-2" />
              Powerful Features
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
              Everything You Need for Research Excellence
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              From initial research to final publication, our AI-powered tools support every stage of your academic
              journey.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Lightbulb className="w-7 h-7 text-blue-600" />}
              title="AI Research Assistant"
              description="Get intelligent suggestions for research directions, methodology improvements, and content enhancement."
              colorClass="bg-blue-100"
              benefits={["Smart topic suggestions", "Methodology guidance", "Real-time writing help"]}
            />
            <FeatureCard
              icon={<Search className="w-7 h-7 text-green-600" />}
              title="Smart Literature Discovery"
              description="Find relevant papers instantly with AI that understands context, methodology, and research gaps."
              colorClass="bg-green-100"
              benefits={["Semantic search", "Relevance scoring", "Gap analysis"]}
            />
            <FeatureCard
              icon={<FileText className="w-7 h-7 text-purple-600" />}
              title="AI-Powered Writing"
              description="Generate high-quality academic content with AI that understands research writing conventions."
              colorClass="bg-purple-100"
              benefits={["Section drafting", "Style consistency", "Academic tone"]}
            />
            <FeatureCard
              icon={<BookOpen className="w-7 h-7 text-orange-600" />}
              title="Citation Management"
              description="Automatically format citations in any style (APA, MLA, Chicago) and manage your bibliography."
              colorClass="bg-orange-100"
              benefits={["Auto-formatting", "Style switching", "Duplicate detection"]}
            />
            <FeatureCard
              icon={<BarChart3 className="w-7 h-7 text-pink-600" />}
              title="Research Analytics"
              description="Get insights into your research progress, writing patterns, and areas for improvement."
              colorClass="bg-pink-100"
              benefits={["Progress tracking", "Writing analytics", "Quality metrics"]}
            />
            <FeatureCard
              icon={<Users className="w-7 h-7 text-indigo-600" />}
              title="Team Collaboration"
              description="Work seamlessly with co-authors, supervisors, and research teams in real-time."
              colorClass="bg-indigo-100"
              benefits={["Real-time editing", "Comment system", "Version control"]}
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-flex items-center px-4 py-2 bg-purple-100 text-purple-800 rounded-full text-sm font-medium mb-6">
              <Target className="w-4 h-4 mr-2" />
              Simple Process
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">From Idea to Publication in 3 Steps</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Our streamlined workflow helps you move from research concept to publication-ready paper efficiently.
            </p>
          </div>

          <div className="relative">
            {/* Connecting line */}
            <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-0.5 bg-gray-200 -translate-y-1/2"></div>

            <div className="grid lg:grid-cols-3 gap-12 relative">
              {[
                {
                  num: 1,
                  title: "Research & Plan",
                  description:
                    "Input your research topic and let AI help you create a comprehensive outline, find relevant literature, and plan your methodology.",
                  icon: <Search className="w-6 h-6" />,
                  color: "blue",
                  features: ["AI topic analysis", "Literature discovery", "Outline generation"],
                },
                {
                  num: 2,
                  title: "Write & Collaborate",
                  description:
                    "Use AI assistance to draft sections, manage citations, and collaborate with your team in real-time with intelligent suggestions.",
                  icon: <FileText className="w-6 h-6" />,
                  color: "purple",
                  features: ["AI writing assistance", "Real-time collaboration", "Smart citations"],
                },
                {
                  num: 3,
                  title: "Review & Publish",
                  description:
                    "Get AI-powered insights on your research quality, check for gaps, and prepare your paper for submission to journals.",
                  icon: <Award className="w-6 h-6" />,
                  color: "green",
                  features: ["Quality analysis", "Gap detection", "Publication prep"],
                },
              ].map((step) => (
                <div key={step.num} className="relative">
                  <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100 text-center relative z-10">
                    <div
                      className={`w-16 h-16 bg-${step.color}-100 border-4 border-${step.color}-500 rounded-full flex items-center justify-center mx-auto mb-6`}
                    >
                      <div className={`text-${step.color}-600`}>{step.icon}</div>
                    </div>
                    <div
                      className={`inline-flex items-center justify-center w-8 h-8 bg-${step.color}-500 text-white rounded-full text-sm font-bold mb-4`}
                    >
                      {step.num}
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4">{step.title}</h3>
                    <p className="text-gray-600 mb-6 leading-relaxed">{step.description}</p>
                    <ul className="space-y-2">
                      {step.features.map((feature, index) => (
                        <li key={index} className="flex items-center justify-center text-sm text-gray-600">
                          <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium mb-6">
              <Star className="w-4 h-4 mr-2" />
              Trusted by Researchers
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">What Researchers Say About Genpaper</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Join thousands of researchers who have transformed their writing process with AI assistance.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                name: "Dr. Sarah Chen",
                role: "Associate Professor, Stanford Medicine",
                quote:
                  "Genpaper reduced my literature review time from weeks to days. The AI suggestions are incredibly accurate and relevant to my research in computational biology.",
                rating: 5,
                avatar: "SC",
                color: "bg-blue-500",
                institution: "Stanford University",
              },
              {
                name: "Prof. Michael Rodriguez",
                role: "Research Director, MIT AI Lab",
                quote:
                  "The citation management alone is worth the subscription. But the AI writing assistance has genuinely improved the quality and clarity of our research papers.",
                rating: 5,
                avatar: "MR",
                color: "bg-purple-500",
                institution: "MIT",
              },
              {
                name: "Dr. Emily Watson",
                role: "Postdoc Researcher, Oxford",
                quote:
                  "As a non-native English speaker, Genpaper's AI helps me write with confidence. The suggestions for academic tone and structure are invaluable.",
                rating: 5,
                avatar: "EW",
                color: "bg-green-500",
                institution: "University of Oxford",
              },
              {
                name: "Dr. James Liu",
                role: "PhD Candidate, Harvard",
                quote:
                  "The collaboration features made working with my advisor seamless. Real-time suggestions and comments streamlined our entire review process.",
                rating: 5,
                avatar: "JL",
                color: "bg-orange-500",
                institution: "Harvard University",
              },
              {
                name: "Prof. Anna Kowalski",
                role: "Department Head, Cambridge",
                quote:
                  "I've supervised over 100 PhD students. Those using Genpaper consistently produce higher quality first drafts and finish faster.",
                rating: 5,
                avatar: "AK",
                color: "bg-pink-500",
                institution: "University of Cambridge",
              },
              {
                name: "Dr. David Park",
                role: "Research Scientist, Google AI",
                quote:
                  "The research gap analysis feature helped us identify unexplored areas in our field. It's like having a research assistant that never sleeps.",
                rating: 5,
                avatar: "DP",
                color: "bg-indigo-500",
                institution: "Google AI",
              },
            ].map((testimonial) => (
              <div
                key={testimonial.name}
                className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-400 fill-current" />
                  ))}
                </div>
                <blockquote className="text-gray-700 mb-6 leading-relaxed">
                  <Quote className="w-6 h-6 text-gray-300 mb-2" />"{testimonial.quote}"
                </blockquote>
                <div className="flex items-center">
                  <div
                    className={`w-12 h-12 rounded-full ${testimonial.color} flex items-center justify-center text-white font-bold text-sm mr-4`}
                  >
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900">{testimonial.name}</div>
                    <div className="text-sm text-gray-600">{testimonial.role}</div>
                    <div className="text-xs text-gray-500">{testimonial.institution}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium mb-6">
              <TrendingUp className="w-4 h-4 mr-2" />
              Simple Pricing
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">Choose Your Research Plan</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Start free and upgrade as your research needs grow. All plans include core AI features.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Free Plan */}
            <div className="bg-gray-50 p-8 rounded-2xl border border-gray-200">
              <div className="text-center mb-8">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Starter</h3>
                <div className="text-4xl font-bold text-gray-900 mb-2">Free</div>
                <p className="text-gray-600">Perfect for getting started</p>
              </div>
              <ul className="space-y-4 mb-8">
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>5 AI-assisted papers per month</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>Basic citation management</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>Literature search</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>Community support</span>
                </li>
              </ul>
              <button className="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-gray-800 transition-colors">
                Get Started Free
              </button>
            </div>

            {/* Pro Plan */}
            <div className="bg-blue-600 p-8 rounded-2xl border-2 border-blue-600 relative">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <span className="bg-yellow-400 text-yellow-900 px-4 py-1 rounded-full text-sm font-bold">
                  Most Popular
                </span>
              </div>
              <div className="text-center mb-8">
                <h3 className="text-xl font-bold text-white mb-2">Professional</h3>
                <div className="text-4xl font-bold text-white mb-2">
                  $29<span className="text-lg">/month</span>
                </div>
                <p className="text-blue-100">For serious researchers</p>
              </div>
              <ul className="space-y-4 mb-8">
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-blue-200 mr-3" />
                  <span className="text-white">Unlimited AI-assisted papers</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-blue-200 mr-3" />
                  <span className="text-white">Advanced citation management</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-blue-200 mr-3" />
                  <span className="text-white">Team collaboration (5 members)</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-blue-200 mr-3" />
                  <span className="text-white">Priority AI suggestions</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-blue-200 mr-3" />
                  <span className="text-white">Research analytics</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-blue-200 mr-3" />
                  <span className="text-white">Priority support</span>
                </li>
              </ul>
              <button className="w-full bg-white text-blue-600 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                Start Free Trial
              </button>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-gray-50 p-8 rounded-2xl border border-gray-200">
              <div className="text-center mb-8">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Enterprise</h3>
                <div className="text-4xl font-bold text-gray-900 mb-2">Custom</div>
                <p className="text-gray-600">For institutions & large teams</p>
              </div>
              <ul className="space-y-4 mb-8">
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>Everything in Professional</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>Unlimited team members</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>Custom AI training</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>SSO & advanced security</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  <span>Dedicated support</span>
                </li>
              </ul>
              <button className="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-gray-800 transition-colors">
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Trusted by Leading Institutions</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 items-center opacity-60">
            {["Stanford", "MIT", "Harvard", "Oxford", "Cambridge"].map((institution) => (
              <div key={institution} className="text-center">
                <div className="text-xl font-bold text-gray-600">{institution}</div>
              </div>
            ))}
          </div>

          <div className="mt-16 grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <Shield className="w-12 h-12 text-blue-600 mx-auto mb-4" />
              <h4 className="text-lg font-semibold text-gray-900 mb-2">Enterprise Security</h4>
              <p className="text-gray-600">SOC 2 compliant with end-to-end encryption</p>
            </div>
            <div className="text-center">
              <Clock className="w-12 h-12 text-green-600 mx-auto mb-4" />
              <h4 className="text-lg font-semibold text-gray-900 mb-2">99.9% Uptime</h4>
              <p className="text-gray-600">Reliable service you can count on</p>
            </div>
            <div className="text-center">
              <Users className="w-12 h-12 text-purple-600 mx-auto mb-4" />
              <h4 className="text-lg font-semibold text-gray-900 mb-2">24/7 Support</h4>
              <p className="text-gray-600">Expert help when you need it</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8 relative">
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-8">Ready to Transform Your Research?</h2>
          <p className="text-xl text-blue-100 mb-12 max-w-2xl mx-auto">
            Join 50,000+ researchers who are already using AI to write better papers, faster. Start your free trial
            today and experience the future of academic writing.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/signup"
              className="bg-white text-blue-600 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-gray-100 transition-colors shadow-lg flex items-center space-x-3"
            >
              <span>Start Free Trial</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <button className="flex items-center space-x-3 text-white hover:text-blue-100 transition-colors">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <Play className="w-5 h-5 ml-0.5" />
              </div>
              <span className="font-medium">Watch Demo</span>
            </button>
          </div>
          <p className="text-sm text-blue-200 mt-6">14-day free trial • No credit card required • Cancel anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-5 gap-8 mb-12">
            <div className="md:col-span-2">
              <Link href="/" className="flex items-center space-x-3 mb-6">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                  <div className="grid grid-cols-2 gap-0.5">
                    <div className="w-1.5 h-1.5 bg-gray-900 rounded-full"></div>
                    <div className="w-1.5 h-1.5 bg-gray-900 rounded-full"></div>
                    <div className="w-1.5 h-1.5 bg-gray-900 rounded-full"></div>
                    <div className="w-1.5 h-1.5 bg-gray-900 rounded-full"></div>
                  </div>
                </div>
                <span className="text-xl font-bold text-white">Genpaper</span>
              </Link>
              <p className="text-gray-400 mb-6 max-w-md">
                AI-powered research assistant helping academics write better papers, faster. Trusted by researchers at
                leading institutions worldwide.
              </p>
              <div className="flex space-x-4">
                <a href="#" className="text-gray-400 hover:text-white transition-colors">
                  Twitter
                </a>
                <a href="#" className="text-gray-400 hover:text-white transition-colors">
                  LinkedIn
                </a>
                <a href="#" className="text-gray-400 hover:text-white transition-colors">
                  GitHub
                </a>
              </div>
            </div>

            <div>
              <h5 className="font-semibold text-white mb-4">Product</h5>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link href="#features" className="hover:text-white transition-colors">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="#pricing" className="hover:text-white transition-colors">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    API
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Integrations
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h5 className="font-semibold text-white mb-4">Resources</h5>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Help Center
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Tutorials
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Research Guide
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h5 className="font-semibold text-white mb-4">Company</h5>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Careers
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Contact
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white transition-colors">
                    Privacy
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-sm text-gray-400">&copy; {new Date().getFullYear()} Genpaper. All rights reserved.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <Link href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                Terms
              </Link>
              <Link href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                Privacy
              </Link>
              <Link href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                Cookies
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
