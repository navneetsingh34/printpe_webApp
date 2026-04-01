import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/routes';
import { AppProviders } from './app/providers';

function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}

export default App;
