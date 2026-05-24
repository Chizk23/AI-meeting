import React from 'react';
import {
  Navbar,
  HeroSection,
  StatsSection,
  FeaturesSection,
  BenefitsSection,
  TestimonialsSection,
  PricingSection,
  CtaSection,
  Footer,
} from '../../../components/landing';

const Landing: React.FC = () => {
  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar transparent />
      <main>
        <HeroSection />
        <StatsSection />
        <FeaturesSection />
        <BenefitsSection />
        <TestimonialsSection />
        <PricingSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
};

export default Landing;
