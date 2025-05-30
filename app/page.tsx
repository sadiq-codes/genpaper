import type React from "react"
import Link from "next/link"
import { ArrowRight, BookOpen, Search, FileText, Users, Lightbulb, BarChart3 } from "lucide-react"

const FeatureCard = ({
  icon,
  title,
  description,
  colorClass,
}: { icon: React.ReactNode; title: string; description: string; colorClass: string }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 hover:shadow-lg transition-shadow duration-300">
    <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-5 ${colorClass}`}>{icon}</div>
    <h3 className="text-lg font-semibold text-cod-gray mb-2">{title}</h3>
    <p className="text-slate-600 text-sm leading-relaxed">{description}</p>
  </div>
)

export default function HomePage() {
  return (
    <div className="min-h-screen bg-alabaster text-cod-gray">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 bg-white rounded"></div>
              </div>
              <span className="text-xl font-bold text-white">GenPaper</span>
            </Link>

            <nav className="hidden md:flex items-center space-x-6">
              <Link href="#features" className="text-sm text-slate-600 hover:text-azure-radiance transition-colors">
                Features
              </Link>
              <Link href="#how-it-works" className="text-sm text-slate-600 hover:text-azure-radiance transition-colors">
                How it Works
              </Link>
              <Link href="#testimonials" className="text-sm text-slate-600 hover:text-azure-radiance transition-colors">
                Testimonials
              </Link>
            </nav>

            <div className="flex items-center space-x-3">
              <Link
                href="/login"
                className="text-sm text-slate-600 hover:text-azure-radiance transition-colors font-medium"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="bg-azure-radiance hover:bg-azure-radiance-darker text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center space-x-1.5"
              >
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-screen-xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="text-left">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-cod-gray mb-6 leading-tight">
                Your AI Partner in
                <span className="block sm:inline bg-gradient-to-r from-azure-radiance to-medium-purple bg-clip-text text-transparent">
                  {" "}
                  Academic Research
                </span>
              </h1>
              <p className="text-lg text-slate-600 mb-8 max-w-xl leading-relaxed">
                Streamline your research with AI-driven outlining, drafting, literature analysis, and citation
                management. Elevate your academic writing.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 items-start mb-10">
                <Link
                  href="/signup"
                  className="bg-azure-radiance hover:bg-azure-radiance-darker text-white px-7 py-3.5 rounded-xl font-semibold text-base transition-all hover:scale-105 flex items-center space-x-2 shadow-md"
                >
                  <span>Start Your Free Trial</span>
                  <ArrowRight className="w-5 h-5" />
                </Link>
              </div>
              <p className="text-xs text-slate-500">No credit card required. Cancel anytime.</p>
            </div>

            {/* Hero Visual - Abstract representation */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-azure-radiance to-medium-purple opacity-10 rounded-full blur-3xl -translate-x-10 -translate-y-10"></div>
              <div className="relative bg-white p-6 rounded-2xl shadow-xl border border-slate-200 aspect-[4/3] flex items-center justify-center">
                {/* Placeholder for a more sophisticated abstract visual or product animation */}
                <div className="space-y-4 w-full">
                  <div className="h-10 bg-slate-100 rounded-md animate-pulse"></div>
                  <div className="h-20 bg-slate-100 rounded-md animate-pulse delay-150"></div>
                  <div className="flex space-x-3">
                    <div className="h-8 w-1/3 bg-slate-100 rounded-md animate-pulse delay-300"></div>
                    <div className="h-8 w-2/3 bg-slate-100 rounded-md animate-pulse delay-300"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-azure-radiance font-semibold text-sm uppercase tracking-wider">Core Features</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-cod-gray mt-2 mb-4">Empowering Your Research Journey</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Leverage cutting-edge AI to enhance every stage of your research paper.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Lightbulb className="w-6 h-6 text-azure-radiance" />}
              title="Intelligent Outlining"
              description="AI crafts structured, logical outlines that map your research narrative effectively."
              colorClass="bg-azure-radiance/10"
            />
            <FeatureCard
              icon={<FileText className="w-6 h-6 text-medium-purple" />}
              title="AI-Powered Drafting"
              description="Generate high-quality academic content, from introductions to conclusions, with AI assistance."
              colorClass="bg-medium-purple/10"
            />
            <FeatureCard
              icon={<Search className="w-6 h-6 text-green-500" />}
              title="Smart Literature Search"
              description="Discover relevant papers and sources with AI that understands research context and nuances."
              colorClass="bg-green-500/10"
            />
            <FeatureCard
              icon={<BookOpen className="w-6 h-6 text-orange-500" />}
              title="Advanced Citation Management"
              description="Automate citation formatting (APA, MLA, Chicago, etc.) and manage your bibliography effortlessly."
              colorClass="bg-orange-500/10"
            />
            <FeatureCard
              icon={<BarChart3 className="w-6 h-6 text-pink-500" />}
              title="Data Analysis & Insights"
              description="Utilize AI for preliminary data analysis, trend identification, and insight generation from your research data."
              colorClass="bg-pink-500/10"
            />
            <FeatureCard
              icon={<Users className="w-6 h-6 text-indigo-500" />}
              title="Collaborative Workspace"
              description="Seamlessly work with co-authors, share feedback, and manage versions in a unified platform."
              colorClass="bg-indigo-500/10"
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 bg-alabaster">
        <div className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-medium-purple font-semibold text-sm uppercase tracking-wider">Simple Process</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-cod-gray mt-2 mb-4">From Idea to Publication-Ready</h2>
          </div>

          <div className="relative">
            {/* Connecting line (for larger screens) */}
            <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-slate-200 -translate-y-1/2"></div>

            <div className="grid md:grid-cols-3 gap-x-8 gap-y-12 relative">
              {[
                {
                  num: 1,
                  title: "Define & Outline",
                  description: "Input your topic. AI helps generate a comprehensive research outline and plan.",
                  color: "azure-radiance",
                },
                {
                  num: 2,
                  title: "Draft & Cite",
                  description: "AI assists in writing sections, finding sources, and managing citations in real-time.",
                  color: "medium-purple",
                },
                {
                  num: 3,
                  title: "Analyze & Refine",
                  description:
                    "Leverage AI for data insights, review suggestions, and polish your paper for submission.",
                  color: "green-500",
                },
              ].map((step) => (
                <div key={step.num} className="text-center bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                  <div
                    className={`w-12 h-12 bg-${step.color}/10 border-2 border-${step.color} rounded-full flex items-center justify-center mx-auto mb-5`}
                  >
                    <span className={`text-xl font-bold text-${step.color}`}>{step.num}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-cod-gray mb-2">{step.title}</h3>
                  <p className="text-slate-600 text-sm">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 bg-white">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-azure-radiance font-semibold text-sm uppercase tracking-wider">Social Proof</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-cod-gray mt-2 mb-4">
              Trusted by Academics & Researchers
            </h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                name: "Dr. Anya Sharma",
                role: "Postdoctoral Fellow, Cambridge",
                quote:
                  "ResearchAI cut my paper writing time in half. The AI outlining and drafting tools are incredibly intuitive.",
                initial: "AS",
                color: "bg-azure-radiance",
              },
              {
                name: "Prof. Ben Carter",
                role: "Lead Researcher, Stanford AI Lab",
                quote:
                  "The literature analysis feature is a game-changer for identifying research gaps. Highly recommended for any serious academic.",
                initial: "BC",
                color: "bg-medium-purple",
              },
              {
                name: "Chloe Davis",
                role: "PhD Candidate, MIT Media Lab",
                quote:
                  "Managing citations and references used to be a nightmare. ResearchAI makes it seamless and accurate.",
                initial: "CD",
                color: "bg-green-500",
              },
            ].map((testimonial) => (
              <div key={testimonial.name} className="bg-alabaster p-8 rounded-xl border border-slate-200">
                <p className="text-slate-700 italic mb-6 leading-relaxed">&quot;{testimonial.quote}&quot;</p>
                <div className="flex items-center">
                  <div
                    className={`w-10 h-10 rounded-full ${testimonial.color} flex items-center justify-center text-white font-semibold text-sm mr-3`}
                  >
                    {testimonial.initial}
                  </div>
                  <div>
                    <div className="font-semibold text-cod-gray">{testimonial.name}</div>
                    <div className="text-sm text-slate-500">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-azure-radiance to-medium-purple">
        <div className="max-w-3xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">Ready to Revolutionize Your Research?</h2>
          <p className="text-lg text-blue-100 mb-10">
            Join thousands of researchers leveraging AI to produce high-impact academic work more efficiently.
          </p>
          <Link
            href="/signup"
            className="bg-white text-azure-radiance px-8 py-4 rounded-xl font-semibold text-base hover:bg-slate-100 transition-colors shadow-lg flex items-center justify-center space-x-2 max-w-xs mx-auto"
          >
            <span>Sign Up for Free</span>
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-cod-gray text-slate-300 py-16">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div>
              <Link href="/" className="flex items-center space-x-2 mb-4">
                <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                  <div className="w-4 h-4 bg-white rounded"></div>
                </div>
                <span className="text-xl font-bold text-white">GenPaper</span>
              </Link>
              <p className="text-sm text-slate-400">AI-powered academic research assistant.</p>
            </div>
            <div>
              <h5 className="font-semibold text-white mb-3">Product</h5>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#features" className="hover:text-white">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white">
                    Integrations
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h5 className="font-semibold text-white mb-3">Resources</h5>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#" className="hover:text-white">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white">
                    Help Center
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white">
                    API Docs
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h5 className="font-semibold text-white mb-3">Company</h5>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#" className="hover:text-white">
                    About Us
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white">
                    Careers
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-white">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-700 pt-8 text-center">
            <p className="text-sm text-slate-400">&copy; {new Date().getFullYear()} ResearchAI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
