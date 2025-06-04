import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Sparkles, 
  BookOpen, 
  Zap, 
  Users, 
  CheckCircle, 
  ArrowRight,
  FileText,
  Search,
  Quote,
  Brain,
  Clock,
  Shield
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-2">
              <Sparkles className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold">GenPaper</span>
              <Badge variant="secondary" className="ml-2">AI-Powered</Badge>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button variant="ghost" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">Start Free Trial</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative">
        <div className="bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 relative overflow-hidden">
          <div className="absolute inset-0 bg-white/40"></div>
          
          {/* Abstract AI Graphic */}
          <div className="absolute inset-0 flex items-center justify-center opacity-10">
            <div className="relative">
              <div className="grid grid-cols-6 gap-8">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-gray-600 rounded-full animate-pulse"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  ></div>
                ))}
              </div>
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 200">
                <path
                  d="M20,20 L280,60 M60,40 L240,120 M40,80 L260,40 M80,160 L220,80 M120,30 L180,150"
                  stroke="rgb(75 85 99)"
                  strokeWidth="1"
                  fill="none"
                  opacity="0.3"
                />
              </svg>
            </div>
          </div>

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
            <div className="text-center">
              <h1 className="text-4xl sm:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                From topic to
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-700 to-gray-900"> finished paper</span>
                — effortlessly
              </h1>
              <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
                GenPaper helps you write well-structured, properly cited research papers in minutes — with sources you can trust.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                <Button size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3" asChild>
                  <Link href="/signup">
                    Start Free Trial
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="px-8 py-3" asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>Focus on ideas, not formatting</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>Perfect for essays, reports, theses</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Everything you need for research excellence
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Comprehensive tools designed to streamline your research workflow from discovery to publication.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Brain className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Write Full Papers in Minutes</CardTitle>
                <CardDescription>
                  Just enter your topic. GenPaper writes a high-quality, citation-ready paper — including introduction, literature review, results, and conclusion.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Search className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Find Trusted Sources Instantly</CardTitle>
                <CardDescription>
                  Get relevant papers from real journals, handpicked by smart search — no more digging through confusing search results.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Quote className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Cite Without Headaches</CardTitle>
                <CardDescription>
                  Citations are generated for you in APA, MLA, or Chicago — with correct formatting, every time.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <BookOpen className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Keep Everything in One Place</CardTitle>
                <CardDescription>
                  Save, organize, and revisit your papers and sources — automatically sorted and easy to find.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Clock className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Track Your Progress</CardTitle>
                <CardDescription>
                  Go back to any draft. GenPaper keeps versions of your work so you never lose a thing.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Private, Always Yours</CardTitle>
                <CardDescription>
                  Your work stays private and secure. GenPaper never shares or trains on your content.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24 bg-muted/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
                Transform your writing workflow
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Join students and researchers who have simplified their academic writing with GenPaper&apos;s easy-to-use tools.
              </p>
              
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <Zap className="h-4 w-4 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">Focus on Ideas, Not Formatting</h3>
                    <p className="text-muted-foreground">Let GenPaper handle structure, citations, and formatting while you focus on your research and arguments.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <FileText className="h-4 w-4 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">No Stress Over Finding Sources</h3>
                    <p className="text-muted-foreground">Reliable papers are included automatically — no more hours spent searching through databases.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <Users className="h-4 w-4 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">Perfect for Any Assignment</h3>
                    <p className="text-muted-foreground">Essays, reports, literature reviews, theses — GenPaper adapts to whatever you&apos;re writing.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-gradient-to-br from-gray-600 to-gray-800 rounded-2xl p-8 text-white">
                <div className="space-y-6">
                  <div className="bg-white/20 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                      <span className="text-sm opacity-90">AI Analysis Complete</span>
                    </div>
                    <div className="bg-white/10 rounded h-2 mb-2">
                      <div className="bg-green-400 h-2 rounded w-full"></div>
                    </div>
                    <p className="text-sm opacity-75">Found 47 relevant sources</p>
                  </div>
                  
                  <div className="bg-white/20 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-3 h-3 bg-gray-400 rounded-full animate-pulse"></div>
                      <span className="text-sm opacity-90">Generating Citations...</span>
                    </div>
                    <div className="bg-white/10 rounded h-2 mb-2">
                      <div className="bg-gray-400 h-2 rounded w-3/4 animate-pulse"></div>
                    </div>
                    <p className="text-sm opacity-75">Processing APA format</p>
                  </div>
                  
                  <div className="text-center pt-4">
                    <p className="text-sm opacity-90">Your research assistant is working...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
            Ready to write your best paper yet?
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            No setup, no stress. Just start writing.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Button size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3" asChild>
              <Link href="/signup">
                Write Your First Paper with GenPaper
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="px-8 py-3" asChild>
              <Link href="/login">Sign In to Continue</Link>
            </Button>
          </div>
          
          <p className="text-sm text-muted-foreground">
            It&apos;s free — no credit card, no complicated setup • Free 14-day trial • Cancel anytime
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">GenPaper</span>
              <span className="text-sm text-muted-foreground ml-2">AI-Powered Research Assistant</span>
            </div>
            
            <div className="flex items-center space-x-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-foreground transition-colors">Support</a>
            </div>
          </div>
          
          <div className="border-t mt-8 pt-8 text-center text-sm text-muted-foreground">
            <p>&copy; 2024 GenPaper. All rights reserved. Built for researchers, by researchers.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
