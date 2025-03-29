#!/bin/bash

# OTORI Vision Server Manager
# A utility script to manage server processes

# Get the base directory
BASE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
FRONTEND_DIR="$BASE_DIR/frontend"
BACKEND_DIR="$BASE_DIR/backend"

function show_help {
  echo "OTORI Vision Server Manager"
  echo "Usage: ./server-manager.sh [command]"
  echo ""
  echo "Commands:"
  echo "  start    - Start all servers (frontend and API)"
  echo "  stop     - Stop all running servers"
  echo "  restart  - Restart all servers"
  echo "  status   - Show running servers"
  echo "  frontend - Start only the frontend server"
  echo "  api      - Start only the API server"
  echo "  help     - Show this help message"
  echo ""
}

function start_all {
  echo "Starting API server..."
  pm2 start "$BACKEND_DIR/server.js" --name otori-price-api
  
  echo "Starting frontend development server..."
  cd "$FRONTEND_DIR" && npm run dev &
  echo "Frontend server started in the background"
}

function stop_all {
  echo "Stopping all Node.js processes..."
  
  # Stop PM2 processes
  pm2 stop all
  
  # Kill any running Node processes
  pkill -f node || true
  
  # Check if port 3000 is still in use (frontend)
  if netstat -tuln | grep -q ':3000 '; then
    echo "Killing process on port 3000..."
    fuser -k 3000/tcp
  fi
  
  # Check if port 3030 is still in use (API)
  if netstat -tuln | grep -q ':3030 '; then
    echo "Killing process on port 3030..."
    fuser -k 3030/tcp
  fi
  
  echo "All servers stopped"
}

function restart_all {
  stop_all
  echo "Waiting for ports to be released..."
  sleep 2
  start_all
}

function check_status {
  echo "Checking running servers..."
  
  echo "PM2 processes:"
  pm2 list
  
  echo "Ports in use:"
  netstat -tuln | grep -E ':3000|:3030' || echo "No OTORI servers running on standard ports"
}

function start_frontend {
  echo "Starting frontend development server..."
  cd "$FRONTEND_DIR" && npm run dev &
  echo "Frontend server started in the background"
}

function start_api {
  echo "Starting API server..."
  pm2 start "$BACKEND_DIR/server.js" --name otori-price-api
}

# Main script execution
case "$1" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    restart_all
    ;;
  status)
    check_status
    ;;
  frontend)
    start_frontend
    ;;
  api)
    start_api
    ;;
  help|*)
    show_help
    ;;
esac

exit 0 