// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  mainSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Home',
    },
    {
      type: 'category',
      label: 'Apex',
      collapsed: false,
      items: [
        'apex/sharing-security',
        'apex/triggers',
        'apex/async-apex',
        'apex/governor-limits',
        'apex/test-classes',
      ],
    },
    {
      type: 'category',
      label: 'LWC',
      items: [
        'lwc/basics',
        'lwc/wire-and-events',
        'lwc/platform-events',
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      items: [
        'integrations/oauth-flows',
        'integrations/named-credentials',
        'integrations/jira-example',
        'integrations/workday-example',
        'integrations/soap',
      ],
    },
    {
      type: 'category',
      label: 'CPQ & Billing',
      items: [
        'cpq-billing/pricing-waterfall',
        'cpq-billing/product-price-rules',
        'cpq-billing/discount-schedules',
        'cpq-billing/quote-to-order',
        'cpq-billing/billing-model',
        'cpq-billing/revenue-recognition',
      ],
    },
    {
      type: 'category',
      label: 'PSA / Certinia',
      items: [
        'psa-certinia/overview',
        'psa-certinia/rate-cards',
        'psa-certinia/revenue-recognition',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/data-modeling',
        'architecture/deployment-devops',
      ],
    },
    {
      type: 'category',
      label: 'DevOps & Copado',
      items: [
        'devops-copado/copado-overview',
        'devops-copado/cicd-patterns',
      ],
    },
    {
      type: 'category',
      label: 'Territory Management',
      items: [
        'territory-mgmt/overview',
      ],
    },
  ],
};

module.exports = sidebars;
