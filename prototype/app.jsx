// App root — wires sidebar, screen routing, toast provider, edit mode

const App = () => {
  const [screen, setScreen] = useState('pos');

  const screens = {
    pos:       <POSTerminal />,
    kds:       <KDS />,
    dashboard: <Dashboard />,
    bom:       <BOMBuilder />,
    inventory: <Inventory />,
    customers: <Customers />,
    reports:   <Reports />,
    settings:  <Settings />,
  };

  return (
    <AppCommon.ToastProvider>
      <div style={{display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden'}}>
        <AppCommon.Sidebar current={screen} onNavigate={setScreen} />
        <main style={{flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden'}} data-screen-label={screen}>
          {screens[screen]}
        </main>
      </div>
    </AppCommon.ToastProvider>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
